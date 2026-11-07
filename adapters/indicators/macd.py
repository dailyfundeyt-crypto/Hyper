"""MACD 12, 26, 9 and its histogram."""

from __future__ import annotations

from adapters.indicators.ema import ema_aligned, ema_series

MACD_FAST = 12
MACD_SLOW = 26
MACD_SIGNAL = 9


def macd_lines(
    values: list[float],
    fast: int = MACD_FAST,
    slow: int = MACD_SLOW,
    signal: int = MACD_SIGNAL,
) -> dict[str, list[float | None]] | None:
    if fast <= 0 or slow <= fast or signal <= 0 or len(values) < slow:
        return None
    fast_line = ema_aligned(values, fast)
    slow_line = ema_aligned(values, slow)
    macd: list[float | None] = []
    for index, _price in enumerate(values):
        fast_value = fast_line[index]
        slow_value = slow_line[index]
        if fast_value is None or slow_value is None:
            macd.append(None)
        else:
            macd.append(fast_value - slow_value)
    present = [value for value in macd if value is not None]
    signal_aligned: list[float | None] = [None] * len(values)
    histogram: list[float | None] = [None] * len(values)
    if len(present) >= signal:
        signal_series = ema_series(present, signal)
        start = (slow - 1) + (signal - 1)
        for offset, value in enumerate(signal_series):
            index = start + offset
            if index >= len(values) or macd[index] is None:
                continue
            signal_aligned[index] = value
            histogram[index] = macd[index] - value  # type: ignore[operator]
    return {"macd": macd, "signal": signal_aligned, "histogram": histogram}


def macd_last(
    values: list[float],
    fast: int = MACD_FAST,
    slow: int = MACD_SLOW,
    signal: int = MACD_SIGNAL,
) -> dict[str, float] | None:
    lines = macd_lines(values, fast, slow, signal)
    if lines is None:
        return None
    macd_value = _last_number(lines["macd"])
    signal_value = _last_number(lines["signal"])
    histogram = _last_number(lines["histogram"])
    if macd_value is None or signal_value is None or histogram is None:
        return None
    return {"macd": macd_value, "signal": signal_value, "histogram": histogram}


def _last_number(values: list[float | None]) -> float | None:
    for value in reversed(values):
        if value is not None:
            return value
    return None
