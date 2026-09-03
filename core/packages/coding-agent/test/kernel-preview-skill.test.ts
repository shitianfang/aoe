import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getBundledSkillsDir } from "../src/config.js";
import type { PythonSkillRuntimeInfo } from "../src/core/skills.js";
import { IpythonKernelProvisioner } from "../src/core/tools/ipython.js";

function bundledPreviewSkill(): PythonSkillRuntimeInfo {
	const packagePath = join(getBundledSkillsDir(), "preview");
	return {
		name: "preview",
		importName: "preview",
		packagePath,
		pyprojectPath: join(packagePath, "pyproject.toml"),
	};
}

describe("preview skill over the kernel host bridge", { tags: ["kernel-heavy"] }, () => {
	let tempDir: string;
	let provisioner: IpythonKernelProvisioner | undefined;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-preview-skill-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(async () => {
		await provisioner?.dispose();
		provisioner = undefined;
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("round-trips preview.publish through a live kernel", async () => {
		const requests: Array<{ type: string; payload: Record<string, unknown> }> = [];
		provisioner = new IpythonKernelProvisioner(tempDir, {
			pythonSkills: [bundledPreviewSkill()],
			hostHandlers: {
				"preview.publish": async (payload) => {
					requests.push({ type: "preview.publish", payload });
					return {
						preview: {
							source: payload.source,
							kind: "file",
							path: `/abs/${payload.source}`,
							...(payload.label !== undefined ? { label: payload.label } : {}),
							timestamp: "2026-09-03T00:00:00.000Z",
							turnIndex: 1,
						},
					};
				},
			},
		});

		const manager = await provisioner.ensure();
		const published = await manager.execute(`
import json
_published = await preview.publish("report.html", label="Quarterly report")
print(json.dumps(_published, sort_keys=True))
`);
		expect(published.status).toBe("ok");
		expect(JSON.parse(published.stdout.trim())).toEqual({
			source: "report.html",
			kind: "file",
			path: "/abs/report.html",
			label: "Quarterly report",
			timestamp: "2026-09-03T00:00:00.000Z",
			turnIndex: 1,
		});
		expect(requests.map((request) => request.type)).toEqual(["preview.publish"]);
		expect(requests[0].payload).toMatchObject({
			type: "preview.publish",
			source: "report.html",
			label: "Quarterly report",
		});

		const typeError = await manager.execute(`
try:
    await preview.publish(7)
except TypeError as error:
    print(f"TypeError: {error}")
`);
		expect(typeError.status).toBe("ok");
		expect(typeError.stdout.trim()).toBe("TypeError: source must be str, got int");
	});

	it("surfaces host validation errors as Python exceptions", async () => {
		provisioner = new IpythonKernelProvisioner(tempDir, {
			pythonSkills: [bundledPreviewSkill()],
			hostHandlers: {
				"preview.publish": async () => {
					throw new Error("preview.publish source does not exist: /abs/missing.html");
				},
			},
		});

		const manager = await provisioner.ensure();
		const missing = await manager.execute(`
try:
    await preview.publish("missing.html")
except RuntimeError as error:
    print(f"RuntimeError: {error}")
`);
		expect(missing.status).toBe("ok");
		expect(missing.stdout.trim()).toBe("RuntimeError: preview.publish source does not exist: /abs/missing.html");
	});
});
