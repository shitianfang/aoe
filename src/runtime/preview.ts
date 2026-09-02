import type { PreviewState } from "../types";

/**
 * Preview source. The runtime has no preview.publish pipeline yet
 * (HANDOFF §6.4) — until it exists this provider returns null and the
 * Preview view shows an honest empty state.
 */
export function getPreviewState(): PreviewState | null {
  return null;
}
