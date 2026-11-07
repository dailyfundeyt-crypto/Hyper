"""Bullish and bearish divergence from swing highs and lows.

Bullish: price lower lows, oscillator higher lows.
Bearish: price higher highs, oscillator lower highs.
"""

from __future__ import annotations

from typing import Any

from adapters.indicators.common import closes_of, highs_of, hollow, lows_of, num
from adapters.indicators.macd import macd_lines
from adapters.indicators.rsi import rsi_series


def fractal_swings(values: list[float], mode: str) -> list[tuple[int, float]]:
    found: list[tuple[int, float]] = []
    for index in range(1, len(values) - 1):
        left, mid, right = values[index - 1], values[index], values[index + 1]
        if mode == "low" and mid < left and mid < right:
            found.append((index, mid))
        elif mode == "high" and mid > left and mid > right:
            found.append((index, mid))
    return found


def divergence_on_swings(
    price: list[float],
    oscillator: list[float | None],
    *,
    bullish: bool,
) -> dict[str, Any] | None:
    swings = fractal_swings(price, "low" if bullish else "high")
    usable: list[tuple[int, float, float]] = []
    for index, price_value in swings:
        if index >= len(oscillator) or oscillator[index] is None:
            continue
        usable.append((index, price_value, float(oscillator[index])))
    if len(usable) < 2:
        return None
    index_a, price_a, osc_a = usable[-2]
    index_b, price_b, osc_b = usable[-1]
    if bullish and price_b < price_a and osc_b > osc_a:
        kind = "bullish"
        side = "long"
    elif not bullish and price_b > price_a and osc_b < osc_a:
        kind = "bearish"
        side = "short"
    else:
        return None
    return {
        "kind": kind,
        "side": side,
        "index_a": index_a,
        "index_b": index_b,
        "price": (price_a, price_b),
        "oscillator": (osc_a, osc_b),
    }


def divergence_branch(candles: list[dict[str, Any]]) -> dict[str, Any]:
    if len(candles) < 20:
        return hollow("not enough bars to look for divergence")
    closes = closes_of(candles)
    rsi = rsi_series(closes, 14)
    macd = macd_lines(closes)
    histogram = macd["histogram"] if macd else [None] * len(closes)
    findings: list[dict[str, Any]] = []
    for bullish in (True, False):
        price = lows_of(candles) if bullish else highs_of(candles)
        for name, series in (("RSI", rsi), ("MACD histogram", histogram)):
            found = divergence_on_swings(price, series, bullish=bullish)
            if found:
                found["oscillator_name"] = name
                findings.append(found)
    sides = {item["side"] for item in findings}
    if len(sides) > 1:
        return hollow("bullish and bearish divergence both printed", contradiction=True)
    if not findings:
        return hollow("no divergence on the available swings")
    found = findings[-1]
    price_a, price_b = found["price"]
    osc_a, osc_b = found["oscillator"]
    reason = (
        f"{found['kind']} divergence on {found['oscillator_name']}: "
        f"price {num(price_a)} to {num(price_b)}, "
        f"oscillator {num(osc_a)} to {num(osc_b)}"
    )
    return {
        "empty": False,
        "side": found["side"],
        "reason": reason,
        "value": None,
        "contradiction": False,
        "kind": found["kind"],
    }
