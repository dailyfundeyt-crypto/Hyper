"""RSI, MACD histogram, and a stochastic RSI flag. No auto-trading."""

from __future__ import annotations

from typing import Any

from adapters.indicators.common import hollow, num
from adapters.indicators.macd import macd_last
from adapters.indicators.rsi import rsi_last
from adapters.indicators.stoch_rsi import stochastic_rsi


def _band(value: float, high: float, low: float) -> str:
    if value > high:
        return "long"
    if value < low:
        return "short"
    return "neutral"


def momentum_branch(closes: list[float]) -> dict[str, Any]:
    rsi = rsi_last(closes, 14)
    macd = macd_last(closes)
    histogram = None if macd is None else macd.get("histogram")
    if rsi is None and histogram is None:
        return hollow("RSI and MACD need a longer close series")
    parts: list[str] = []
    sides: list[str] = []
    if rsi is not None:
        side = _band(rsi, 55, 45)
        sides.append(side)
        parts.append(f"RSI 14 is {num(rsi)} ({side})")
    if histogram is not None:
        if histogram > 0:
            side = "long"
        elif histogram < 0:
            side = "short"
        else:
            side = "neutral"
        sides.append(side)
        parts.append(f"MACD histogram is {num(histogram)} ({side})")
    directional = {side for side in sides if side in ("long", "short")}
    stoch = stochastic_rsi(closes)
    flag = ""
    if not stoch.get("empty"):
        if stoch.get("overbought"):
            flag = " Stochastic RSI is overbought. That is a flag, not an order."
        elif stoch.get("oversold"):
            flag = " Stochastic RSI is oversold. That is a flag, not an order."
        else:
            flag = f" Stochastic RSI %K is {num(float(stoch['k']))}."
    if len(directional) > 1:
        return hollow("momentum readings contradict: " + "; ".join(parts) + "." + flag, contradiction=True)
    if not directional:
        side = "neutral"
    else:
        side = directional.pop()
    return {
        "empty": False,
        "side": side,
        "reason": "; ".join(parts) + "." + flag,
        "value": rsi,
        "contradiction": False,
    }
