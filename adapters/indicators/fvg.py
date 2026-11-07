"""A simple 3-candle fair value gap on recent bars."""

from __future__ import annotations

from typing import Any

from adapters.indicators.common import hollow, num


def latest_fvg(candles: list[dict[str, Any]], lookback: int = 20) -> dict[str, Any]:
    if len(candles) < 3:
        return hollow("need 3 candles for a fair value gap")
    start = max(0, len(candles) - lookback)
    found: dict[str, Any] | None = None
    for index in range(start, len(candles) - 2):
        first = candles[index]
        third = candles[index + 2]
        if third["low"] > first["high"]:
            found = {
                "side": "long",
                "kind": "bullish fair value gap",
                "bottom": float(first["high"]),
                "top": float(third["low"]),
                "index": index,
            }
        elif third["high"] < first["low"]:
            found = {
                "side": "short",
                "kind": "bearish fair value gap",
                "bottom": float(third["high"]),
                "top": float(first["low"]),
                "index": index,
            }
    if found is None:
        return hollow("no fair value gap on the recent bars")
    found["empty"] = False
    found["contradiction"] = False
    found["value"] = found["bottom"]
    found["reason"] = f"{found['kind']} between {num(found['bottom'])} and {num(found['top'])}"
    return found
