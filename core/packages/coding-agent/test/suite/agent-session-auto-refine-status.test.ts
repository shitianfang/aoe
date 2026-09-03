import { afterEach, describe, expect, it } from "vitest";
import type { AgentSessionRuntime } from "../../src/core/agent-session-runtime.js";
import { createAgentConnectionState } from "../../src/modes/agent-connection/snapshot.js";
import { createHarness, type Harness } from "./harness.js";

describe("AgentSession auto-refine status surface", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("exposes effective settings and omits lastReviewAt before the first review", async () => {
		const harness = await createHarness({
			settings: { autoRefine: { turnInterval: 7, cooldownMs: 60_000 } },
		});
		harnesses.push(harness);

		expect(harness.session.lastAutoRefineReviewAt).toBeUndefined();
		const status = harness.session.getAutoRefineStatus();
		expect(status).toEqual({
			enabled: true,
			turnInterval: 7,
			compact: true,
			cooldownMs: 60_000,
		});
		expect(status).not.toHaveProperty("lastReviewAt");
	});

	it("reports the last review timestamp once a review checkpoint has run", async () => {
		const harness = await createHarness({});
		harnesses.push(harness);
		const reviewedAt = Date.now() - 5_000;
		(harness.session as unknown as { _lastAutoRefineReviewAt: number })._lastAutoRefineReviewAt = reviewedAt;

		expect(harness.session.lastAutoRefineReviewAt).toBe(reviewedAt);
		expect(harness.session.getAutoRefineStatus().lastReviewAt).toBe(reviewedAt);
	});

	it("includes the autoRefine block in connection state", async () => {
		const harness = await createHarness({});
		harnesses.push(harness);
		const reviewedAt = Date.now();
		(harness.session as unknown as { _lastAutoRefineReviewAt: number })._lastAutoRefineReviewAt = reviewedAt;

		const state = createAgentConnectionState({ session: harness.session } as AgentSessionRuntime, "active-1");

		expect(state.autoRefine).toEqual(harness.session.getAutoRefineStatus());
		expect(state.autoRefine?.lastReviewAt).toBe(reviewedAt);
	});

	it("includes the autonomous status block in connection state", async () => {
		const harness = await createHarness({});
		harnesses.push(harness);

		const state = createAgentConnectionState({ session: harness.session } as AgentSessionRuntime, "active-1");

		expect(state.autonomous).toEqual(harness.session.getAutonomousStatus());
		expect(state.autonomous?.enabled).toBe(false);
	});
});
