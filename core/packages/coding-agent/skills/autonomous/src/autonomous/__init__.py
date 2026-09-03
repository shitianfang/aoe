"""Prime Agent autonomous skill: read and switch autonomous mode from the kernel.

`get`, `enable`, and `disable` are thin typed wrappers over the generic host
bridge (`rlm.host_request`). The host owns the runtime state, validates the
limit values exactly as the `/autonomous on` command does, and emits an
`autonomous_status` message so attached clients see the change. This only
works inside the Prime Agent Python kernel.
"""

from __future__ import annotations

from typing import Any

from rlm import host_request

_LIMIT_KEYS = ("turns", "tokens", "time", "continuations")


async def get() -> dict[str, Any]:
    """Return the current autonomous status dict."""
    result = await host_request("autonomous.get", {})
    return result["autonomous"]


async def enable(
    turns: int | str | None = None,
    tokens: int | str | None = None,
    time: int | str | None = None,
    continuations: int | str | None = None,
) -> dict[str, Any]:
    """Switch autonomous mode on, resetting its counters, and return the status.

    Omitted limits fall back to the session baseline. `tokens` accepts a plain
    count or a `k`/`m` suffix; `time` accepts `s`/`m`/`h` and reads a bare
    number as minutes. Fails when autonomous mode is already on.
    """
    payload: dict[str, Any] = {}
    for key, value in zip(_LIMIT_KEYS, (turns, tokens, time, continuations)):
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, (int, str)):
            raise TypeError(f"{key} must be int, str or None, got {type(value).__name__}")
        payload[key] = str(value)
    result = await host_request("autonomous.enable", payload)
    return result["autonomous"]


async def disable() -> dict[str, Any]:
    """Switch autonomous mode off and return the status."""
    result = await host_request("autonomous.disable", {})
    return result["autonomous"]
