"""Stochastic RSI. Overbought and oversold are flags, not orders."""

from __future__ import annotations

from typing import Any

from adapters.indicators.common import hollow
from adapters.indicators.rsi import RSI_PERIOD, rsi_series

STOCH_PERIOD = 14
STOCH_K = 3
STOCH_D = 3
OVERBOUGHT = 80.0
OVERSOLD = 20.0


def stoch_of_window(window: list[float]) -> float | None:
    if len(window) < 2:
        return None
    low = min(window)
    high = max(window)
    if high == low:
        return None
    return (window[-1] - low) / (high - low) * 100.0


def stochastic_rsi(
    closes: list[float],
    rsi_period: int = RSI_PERIOD,
    stoch_period: int = STOCH_PERIOD,
    k_smooth: int = STOCH_K,
    d_smooth: int = STOCH_D,
) -> dict[str, Any]:
    series = [value for value in rsi_series(closes, rsi_period) if value is not None]
    if len(series) < stoch_period:
        return hollow("not enough RSI values for stochastic RSI")
    raw: list[float] = []
    for end in range(stoch_period, len(series) + 1):
        value = stoch_of_window(series[end - stoch_period : end])
        if value is not None:
            raw.append(value)
    if len(raw) < k_smooth:
        return hollow("stochastic RSI range is zero or too short")
    k = sum(raw[-k_smooth:]) / k_smooth
    d_value: float | None = None
    if len(raw) >= k_smooth + d_smooth - 1:
        smoothed = [sum(raw[index - k_smooth : index]) / k_smooth for index in range(k_smooth, len(raw) + 1)]
        if len(smoothed) >= d_smooth:
            d_value = sum(smoothed[-d_smooth:]) / d_smooth
    return {
        "empty": False,
        "side": None,
        "value": k,
        "k": k,
        "d": d_value,
        "overbought": k >= OVERBOUGHT,
        "oversold": k <= OVERSOLD,
        "contradiction": False,
        "reason": f"stochastic RSI %K {k:.4g}",
    }
