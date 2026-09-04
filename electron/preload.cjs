// Reserved for the daemon bridge (prime-agent protocol v4). The one thing
// exposed is the first-run question — which host runs AOE — because the page
// that asks it is a local file with no other way to reach main. Main answers
// these only for file:// frames, so the UI loaded from a host cannot use them
// to point the window somewhere else.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aoeHost", {
  /** Does this address answer? Checked before it is kept, so a typo is caught
   *  while the user is still looking at what they typed. */
  probe: (url) => ipcRenderer.invoke("aoe:probe-host", url),
  /** Keep it and open it. */
  use: (url) => ipcRenderer.invoke("aoe:use-host", url),
  /** Back to the question — from the page that says the host went away. */
  change: () => ipcRenderer.invoke("aoe:change-host"),
});
