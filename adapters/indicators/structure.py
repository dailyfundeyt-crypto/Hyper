"""Swing highs and lows, then a break of structure or a change of character."""

from __future__ import annotations

from typing import Any

from adapters.indicators.common import highs_of, hollow, lows_of, num
from adapters.indicators.divergence import fractal_swings
from adapters.indicators.fvg import latest_fvg


def structure_branch(candles: list[dict[str, Any]]) -> dict[str, Any]:
    if len(candles) < 5:
        return hollow("need swing highs and lows")
    swing_highs = fractal_swings(highs_of(candles), "high")
    swing_lows = fractal_swings(lows_of(candles), "low")
    if len(swing_highs) < 2 or len(swing_lows) < 2:
        gap = latest_fvg(candles)
        if not gap.get("empty"):
            return {
                "empty": False,
                "side": gap["side"],
                "reason": gap["reason"],
                "value": gap.get("value"),
                "contradiction": False,
                "kind": "fvg",
            }
        return hollow("not enough swings for structure")
    close = float(candles[-1]["close"])
    last_high = swing_highs[-1][1]
    prev_high = swing_highs[-2][1]
    last_low = swing_lows[-1][1]
    prev_low = swing_lows[-2][1]
    up = last_high > prev_high and last_low > prev_low
    down = last_high < prev_high and last_low < prev_low
    broke_up = close > last_high
    broke_down = close < last_low
    gap = latest_fvg(candles)
    if not broke_up and not broke_down:
        if not gap.get("empty"):
            return {
                "empty": False,
                "side": gap["side"],
                "reason": gap["reason"],
                "value": gap.get("value"),
                "contradiction": False,
                "kind": "fvg",
            }
        return hollow("no break of structure on the latest close")
    if broke_up:
        kind = "bos" if up or not down else "choch"
        side = "long"
        level = last_high
        direction = "up"
    else:
        kind = "bos" if down or not up else "choch"
        side = "short"
        level = last_low
        direction = "down"
    reason = f"{kind} {direction} through {num(level)}"
    if not gap.get("empty") and gap.get("side") != side:
        return hollow(
            f"{reason}, while {gap['reason']}",
            contradiction=True,
        )
    if not gap.get("empty"):
        reason = f"{reason}; {gap['reason']}"
    return {
        "empty": False,
        "side": side,
        "reason": reason,
        "value": level,
        "contradiction": False,
        "kind": kind,
    }
