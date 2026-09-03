"""Prime Agent preview skill: declare work products from the kernel.

`publish` is a thin typed wrapper over the generic host bridge
(`rlm.host_request`). The host validates the source, records the publication
in the session transcript, and emits a `preview_published` session event for
attached clients; it never watches or snapshots the source. This only works
inside the Prime Agent Python kernel.
"""

from __future__ import annotations

from typing import Any

from rlm import host_request


async def publish(source: str, label: str | None = None) -> dict[str, Any]:
    """Declare `source` as a finished work product.

    `source` is a file path (absolute or relative to the workspace) or an
    `http(s)://` URL; a file path must exist. `label` is an optional short
    human-readable title. Returns the recorded preview dict with `source`,
    `kind`, `path` (files only), `label`, `timestamp`, and `turnIndex`.
    """
    if not isinstance(source, str):
        raise TypeError(f"source must be str, got {type(source).__name__}")
    if label is not None and not isinstance(label, str):
        raise TypeError(f"label must be str or None, got {type(label).__name__}")
    payload: dict[str, Any] = {"source": source}
    if label is not None:
        payload["label"] = label
    result = await host_request("preview.publish", payload)
    return result["preview"]
