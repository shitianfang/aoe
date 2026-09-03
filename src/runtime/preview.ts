import type { PreviewFile } from "../types";
import { bridgeUrl } from "./bridge";

/**
 * Preview source (client-inferred v1). The bridge watches edit/write tool
 * events and snapshots changed files at agent_end; this module just pulls
 * that index and addresses version content.
 */
export async function fetchPreviewFiles(): Promise<PreviewFile[]> {
  const res = await fetch(bridgeUrl("/bridge/preview"));
  if (!res.ok) return [];
  const data = (await res.json().catch(() => null)) as { files?: PreviewFile[] } | null;
  return Array.isArray(data?.files) ? data.files : [];
}

/** URL for one version's raw content; no `v` (or "live") = current file. */
export function previewFileUrl(path: string, v?: string): string {
  const q = new URLSearchParams({ path });
  if (v) q.set("v", v);
  return bridgeUrl(`/bridge/preview/file?${q.toString()}`);
}

export async function fetchPreviewText(path: string, v?: string): Promise<string | null> {
  try {
    const res = await fetch(previewFileUrl(path, v));
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}
