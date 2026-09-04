/**
 * Offscreen render of one file in the workspace — the client's verify step.
 *
 * The judges in `skills/aoe-way` used to read HTML source, which is why that
 * skill had to warn them they could not see scale: a round that repaints a 10px
 * dot is true in the diff and invisible in the pane. This renders the candidate
 * the way the Preview pane will and hands back two things: a PNG anyone (the
 * agent, a judge subagent via `attach_image`) can actually look at, and the
 * list of things the page got wrong while loading — broken images, horizontal
 * overflow, an empty body, console errors. Source review cannot see any of
 * those either, and a page that fails one of them can still win a vote on its
 * markup.
 *
 * Two ways in, one implementation:
 *   - in Electron main (the packaged app imports bridge.mjs there) the bridge
 *     calls capture() directly;
 *   - under `npm run bridge` the bridge spawns the electron binary on this
 *     file, which reads SHOT_IN/SHOT_OUT/SHOT_W and prints the same JSON.
 */
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_WIDTH = 1200;
/** Tall enough for a poster or a long report; past this the picture stops
 *  being readable at the size a model gets it, so the shot is marked cropped
 *  rather than silently ending early. */
const MAX_HEIGHT = 4000;
const LOAD_TIMEOUT_MS = 20_000;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** SHOT_DEBUG=1 traces the stages on stderr — the report says a shot failed,
 *  this says where. */
const dbg = process.env.SHOT_DEBUG ? (m) => process.stderr.write(`[shot] ${m}\n`) : () => {};

/** What a page can get wrong without any of it showing up in its source. */
const PROBE = `(() => {
  const el = document.documentElement, b = document.body;
  const broken = [...document.images]
    .filter((i) => !i.complete || i.naturalWidth === 0)
    .map((i) => i.getAttribute("src") || "(no src)");
  return JSON.stringify({
    height: Math.max(el.scrollHeight, b ? b.scrollHeight : 0),
    scrollWidth: el.scrollWidth,
    innerWidth: window.innerWidth,
    text: b ? (b.innerText || "").trim().length : 0,
    broken: broken.slice(0, 10),
    brokenCount: broken.length,
  });
})()`;

/**
 * @param {object} o
 * @param {any} o.electron  the electron module (app must already be ready)
 * @param {string} o.input  absolute path to the file to render
 * @param {string} o.out    absolute path of the PNG to write
 * @param {number} [o.width]
 * @returns {Promise<object>} the report — never throws for a bad page, only
 *          for a broken renderer, so a caller can always report something.
 */
async function capture({ electron, input, out, width = DEFAULT_WIDTH }) {
  const { BrowserWindow } = electron;
  const problems = [];
  // A partition with no `persist:` prefix is in-memory and dies with the
  // window: the packaged app renders the real Preview in the default session,
  // and a candidate page must not touch its cache or cookies. Nothing here
  // calls clearStorageData — it blocks the main thread outright on a box with
  // no GPU or storage service, which is exactly where shots get taken.
  const part = `shot-${process.pid}-${Math.round(process.uptime() * 1000)}`;
  const win = new BrowserWindow({
    width,
    height: 900,
    show: false,
    webPreferences: {
      offscreen: true,
      partition: part,
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  /** @type {any} */ let frame = null;
  win.webContents.on("paint", (_e, _dirty, image) => {
    frame = image;
  });
  win.webContents.setFrameRate(30);
  win.webContents.on("console-message", (_e, level, message, line, source) => {
    // 2 = warning, 3 = error. Anything quieter is the page talking to itself,
    // and Electron's own security lecture is about the renderer, not the page.
    if (level < 2 || String(message).includes("Electron Security Warning")) return;
    const at = source ? ` (${path.basename(String(source))}:${line})` : "";
    const one = `console: ${String(message).slice(0, 200)}${at}`;
    if (!problems.includes(one)) problems.push(one);
  });
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    problems.push(`failed to load ${url || input}: ${desc} (${code})`);
  });

  let probe = null;
  let cropped = false;
  try {
    dbg(`loading ${input}`);
    const loaded = win.loadFile(input);
    await Promise.race([loaded, wait(LOAD_TIMEOUT_MS)]);
    // Webfonts and images resolve after load; without this the shot is of a
    // half-painted page and every judge votes on the wrong picture.
    dbg("loaded; waiting for fonts");
    await Promise.race([
      win.webContents
        .executeJavaScript("document.fonts ? document.fonts.ready.then(() => 1) : 1")
        .catch(() => null),
      wait(5000),
    ]);
    await wait(400);
    dbg("probing");
    probe = JSON.parse(await win.webContents.executeJavaScript(PROBE));
    dbg(`probe ${JSON.stringify(probe)}`);

    // Grow the window to the whole page: a viewport-height shot of a poster
    // says nothing about the half nobody scrolled to.
    const full = Math.max(200, Math.ceil(probe.height));
    const h = Math.min(full, MAX_HEIGHT);
    cropped = full > MAX_HEIGHT;
    win.setContentSize(width, h);
    win.webContents.invalidate();
    // Offscreen paints arrive on the frame clock; give the resize a few.
    for (let i = 0; i < 40 && (!frame || frame.getSize().height < h - 4); i += 1) await wait(100);
    dbg(`painted ${frame ? frame.getSize().height : 0}px of ${h}px`);
  } catch (e) {
    problems.push(`render: ${e?.message || String(e)}`);
  }

  let bytes = 0;
  try {
    if (frame) {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const png = frame.toPNG();
      fs.writeFileSync(out, png);
      bytes = png.length;
    }
  } catch (e) {
    problems.push(`write: ${e?.message || String(e)}`);
  }
  const size = frame ? frame.getSize() : { width: 0, height: 0 };
  try {
    dbg("teardown");
    win.destroy();
    dbg("torn down");
  } catch {
    /* teardown is best-effort; the report is already made */
  }

  if (probe) {
    if (probe.brokenCount > 0) {
      problems.push(`${probe.brokenCount} image(s) did not load: ${probe.broken.join(", ")}`);
    }
    // 2px of slack: subpixel layout rounds a flush-fit page over by a hair.
    if (probe.scrollWidth > probe.innerWidth + 2) {
      problems.push(
        `page scrolls sideways at ${probe.innerWidth}px: content is ${probe.scrollWidth}px wide`,
      );
    }
    if (probe.text < 8) problems.push("the rendered page has almost no text on it");
  }
  if (!frame) problems.push("nothing was painted — the page never rendered");

  return {
    ok: bytes > 0,
    png: out,
    bytes,
    width: size.width,
    height: size.height,
    fullHeight: probe ? Math.ceil(probe.height) : 0,
    cropped,
    problems,
  };
}

module.exports = { capture, DEFAULT_WIDTH };

// Spawned form: `electron shot.cjs` with the job in the environment. The last
// line of stdout is the report, so the bridge can ignore whatever Chromium
// prints on its way up. The switch is SHOT_STANDALONE and not
// `require.main === module`: Electron loads the script it is given through its
// own bootstrap, so this file is never the main module even when it is the
// only thing running — and the bridge's in-process path requires it for
// capture() alone, which must not start a second app.
if (process.env.SHOT_STANDALONE === "1") {
  const { app } = require("electron");
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "1";
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.whenReady().then(async () => {
    let report;
    try {
      report = await capture({
        electron: require("electron"),
        input: process.env.SHOT_IN,
        out: process.env.SHOT_OUT,
        width: Number(process.env.SHOT_W) || DEFAULT_WIDTH,
      });
    } catch (e) {
      report = { ok: false, problems: [`renderer: ${e?.message || String(e)}`] };
    }
    process.stdout.write(`\n__SHOT__${JSON.stringify(report)}\n`);
    app.exit(0);
  });
}
