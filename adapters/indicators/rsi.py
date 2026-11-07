"""Wilder RSI. The default length is 14."""

from __future__ import annotations

RSI_PERIOD = 14


def _from_averages(avg_gain: float, avg_loss: float) -> float | None:
    if avg_gain == 0 and avg_loss == 0:
        return None
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def rsi_series(closes: list[float], period: int = RSI_PERIOD) -> list[float | None]:
    """RSI aligned to the close index. Leading values are None until the window fills."""

    out: list[float | None] = [None] * len(closes)
    if period <= 0 or len(closes) < period + 1:
        return out
    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains = [max(delta, 0.0) for delta in deltas]
    losses = [max(-delta, 0.0) for delta in deltas]
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    out[period] = _from_averages(avg_gain, avg_loss)
    for index in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[index]) / period
        avg_loss = (avg_loss * (period - 1) + losses[index]) / period
        out[index + 1] = _from_averages(avg_gain, avg_loss)
    return out


def rsi_last(closes: list[float], period: int = RSI_PERIOD) -> float | None:
    series = rsi_series(closes, period)
    for value in reversed(series):
        if value is not None:
            return value
    return None
