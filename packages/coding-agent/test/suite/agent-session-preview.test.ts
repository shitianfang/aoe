import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentSession } from "../../src/core/agent-session.js";
import { createPreviewRecord, PREVIEW_CUSTOM_TYPE, type PreviewRecord } from "../../src/core/preview.js";
import { createHarness, type Harness } from "./harness.js";

function previewEntries(harness: Harness) {
	return harness.sessionManager
		.getBranch()
		.filter((entry) => entry.type === "custom" && entry.customType === PREVIEW_CUSTOM_TYPE);
}

/**
 * Stand-in for the real ipython tool: preview.publish reaches the host over
 * the kernel comm bridge while a cell executes, so this stub dispatches the
 * host request from inside tool execution.
 */
function createFauxIpythonTool(sessionRef: { current?: AgentSession }): AgentTool {
	return {
		name: "ipython",
		label: "ipython",
		description: "Execute Python code in the agent kernel.",
		parameters: Type.Object({ code: Type.String() }),
		execute: async (_toolCallId, params) => {
			const session = sessionRef.current;
			if (!session) {
				throw new Error("test session is not initialized");
			}
			const code = (params as { code: string }).code.trim();
			const spaceIndex = code.indexOf(" ");
			const type = spaceIndex < 0 ? code : code.slice(0, spaceIndex);
			const payload = spaceIndex < 0 ? {} : JSON.parse(code.slice(spaceIndex + 1));
			const text = JSON.stringify(session.handlePreviewHostRequest(type, payload));
			return {
				content: [{ type: "text", text }],
				details: {},
			};
		},
	};
}

describe("AgentSession preview publication", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		for (const harness of harnesses.splice(0)) {
			harness.cleanup();
		}
	});

	async function setup(options: Parameters<typeof createHarness>[0] = {}): Promise<Harness> {
		const harness = await createHarness(options);
		harnesses.push(harness);
		return harness;
	}

	it("records a transcript entry and emits preview_published for an existing file", async () => {
		const harness = await setup();
		const artifact = join(harness.tempDir, "report.html");
		writeFileSync(artifact, "<h1>report</h1>");

		const result = harness.session.handlePreviewHostRequest("preview.publish", {
			source: "report.html",
			label: "Quarterly report",
		}) as { preview: PreviewRecord };

		expect(result.preview).toMatchObject({
			source: "report.html",
			kind: "file",
			path: artifact,
			label: "Quarterly report",
			turnIndex: 0,
		});
		expect(new Date(result.preview.timestamp).getTime()).not.toBeNaN();

		const events = harness.eventsOfType("preview_published");
		expect(events).toHaveLength(1);
		expect(events[0].preview).toEqual(result.preview);

		const entries = previewEntries(harness);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ data: result.preview });
	});

	it("accepts served URLs without touching the filesystem", async () => {
		const harness = await setup();

		const result = harness.session.handlePreviewHostRequest("preview.publish", {
			source: "http://localhost:5173",
		}) as { preview: PreviewRecord };

		expect(result.preview).toMatchObject({ source: "http://localhost:5173", kind: "url" });
		expect(result.preview.path).toBeUndefined();
		expect(result.preview.label).toBeUndefined();
		expect(harness.eventsOfType("preview_published")).toHaveLength(1);
	});

	it("rejects missing files without recording anything", async () => {
		const harness = await setup();

		expect(() => harness.session.handlePreviewHostRequest("preview.publish", { source: "missing.html" })).toThrow(
			/does not exist/,
		);
		expect(harness.eventsOfType("preview_published")).toHaveLength(0);
		expect(previewEntries(harness)).toHaveLength(0);
	});

	it("rejects invalid payloads and unknown request types", async () => {
		const harness = await setup();

		expect(() => harness.session.handlePreviewHostRequest("preview.publish", {})).toThrow(
			/source must be a non-empty string/,
		);
		expect(() => harness.session.handlePreviewHostRequest("preview.publish", { source: "a.html", label: 7 })).toThrow(
			/label must be a string/,
		);
		expect(() => harness.session.handlePreviewHostRequest("preview.unknown", {})).toThrow(
			/unknown preview request type/,
		);
	});

	it("stamps the turn index of the turn that published", async () => {
		const sessionRef: { current?: AgentSession } = {};
		const harness = await setup({ tools: [createFauxIpythonTool(sessionRef)] });
		sessionRef.current = harness.session;
		const artifact = join(harness.tempDir, "site", "index.html");
		mkdirSync(join(harness.tempDir, "site"), { recursive: true });
		writeFileSync(artifact, "<h1>site</h1>");

		harness.setResponses([
			fauxAssistantMessage("working"),
			fauxAssistantMessage(
				fauxToolCall("ipython", {
					code: `preview.publish {"source": ${JSON.stringify(artifact)}, "label": "Site"}`,
				}),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("first turn");
		await harness.session.prompt("publish the site");

		const events = harness.eventsOfType("preview_published");
		expect(events).toHaveLength(1);
		expect(events[0].preview).toMatchObject({
			source: artifact,
			kind: "file",
			path: artifact,
			label: "Site",
		});
		expect(events[0].preview.turnIndex).toBeGreaterThanOrEqual(0);
		expect(previewEntries(harness)).toHaveLength(1);
	});
});

describe("createPreviewRecord", () => {
	it("resolves relative sources against the cwd and trims the label", () => {
		const record = createPreviewRecord(
			{ source: " out/plot.png ", label: "  Plot  " },
			{
				cwd: "/workspace/project",
				turnIndex: 3,
				fileExists: (path) => path === "/workspace/project/out/plot.png",
				now: () => new Date("2026-09-03T00:00:00.000Z"),
			},
		);
		expect(record).toEqual({
			source: "out/plot.png",
			kind: "file",
			path: "/workspace/project/out/plot.png",
			label: "Plot",
			timestamp: "2026-09-03T00:00:00.000Z",
			turnIndex: 3,
		});
	});

	it("drops empty labels and rejects oversized ones", () => {
		const options = { cwd: "/w", turnIndex: 0, fileExists: () => true };
		expect(createPreviewRecord({ source: "/w/a.html", label: "  " }, options).label).toBeUndefined();
		expect(() => createPreviewRecord({ source: "/w/a.html", label: "x".repeat(201) }, options)).toThrow(
			/at most 200 characters/,
		);
	});
});
