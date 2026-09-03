import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export const PREVIEW_CUSTOM_TYPE = "prime-agent.preview";
export const PREVIEW_SKILL_NAME = "preview";
export const PREVIEW_LABEL_MAX_LENGTH = 200;

export type PreviewSourceKind = "file" | "url";

/**
 * A work product the agent explicitly declared via `preview.publish`. The host
 * only records and announces it; snapshotting, watching, or rendering the
 * source is the client's responsibility.
 */
export interface PreviewRecord {
	/** The source exactly as the caller passed it: a path or a served URL. */
	source: string;
	kind: PreviewSourceKind;
	/** Absolute filesystem path; present only for kind "file". */
	path?: string;
	label?: string;
	/** ISO 8601 publication time. */
	timestamp: string;
	/** Turn index within the agent run that published the preview. */
	turnIndex: number;
}

export interface CreatePreviewRecordOptions {
	cwd: string;
	turnIndex: number;
	fileExists?: (path: string) => boolean;
	now?: () => Date;
}

function isUrlSource(source: string): boolean {
	return /^https?:\/\//i.test(source);
}

/** Validate a preview.publish payload and build the durable record. */
export function createPreviewRecord(
	payload: Record<string, unknown>,
	options: CreatePreviewRecordOptions,
): PreviewRecord {
	if (typeof payload.source !== "string" || !payload.source.trim()) {
		throw new Error("preview.publish source must be a non-empty string");
	}
	if (payload.label !== undefined && typeof payload.label !== "string") {
		throw new Error("preview.publish label must be a string when provided");
	}
	const source = payload.source.trim();
	const label = payload.label?.trim() || undefined;
	if (label !== undefined && label.length > PREVIEW_LABEL_MAX_LENGTH) {
		throw new Error(`preview.publish label must be at most ${PREVIEW_LABEL_MAX_LENGTH} characters`);
	}
	const timestamp = (options.now?.() ?? new Date()).toISOString();
	if (isUrlSource(source)) {
		return {
			source,
			kind: "url",
			...(label !== undefined ? { label } : {}),
			timestamp,
			turnIndex: options.turnIndex,
		};
	}
	const path = isAbsolute(source) ? source : resolve(options.cwd, source);
	const fileExists = options.fileExists ?? existsSync;
	if (!fileExists(path)) {
		throw new Error(`preview.publish source does not exist: ${path}`);
	}
	return {
		source,
		kind: "file",
		path,
		...(label !== undefined ? { label } : {}),
		timestamp,
		turnIndex: options.turnIndex,
	};
}
