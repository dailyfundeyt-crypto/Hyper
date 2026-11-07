"""200/50 EMA, computed two ways so a mismatch can be marked."""

from __future__ import annotations


def ema_series(values: list[float], period: int) -> list[float]:
    """EMA seeded with the SMA of the first window.

    The first value corresponds to index ``period - 1``.
    Formula: previous + k * (price - previous), with k = 2 / (period + 1).
    """

    if period <= 0 or len(values) < period:
        return []
    k = 2.0 / (period + 1.0)
    current = sum(values[:period]) / period
    out = [current]
    for price in values[period:]:
        current = current + k * (price - current)
        out.append(current)
    return out


def ema_series_alternate(values: list[float], period: int) -> list[float]:
    """Same EMA written as price * k + previous * (1 - k)."""

    if period <= 0 or len(values) < period:
        return []
    k = 2.0 / (period + 1.0)
    current = sum(values[:period]) / period
    out = [current]
    for price in values[period:]:
        current = (price * k) + (current * (1.0 - k))
        out.append(current)
    return out


def ema_last(values: list[float], period: int) -> float | None:
    series = ema_series(values, period)
    if not series:
        return None
    return series[-1]


def ema_aligned(values: list[float], period: int) -> list[float | None]:
    aligned: list[float | None] = [None] * len(values)
    series = ema_series(values, period)
    start = period - 1
    for offset, value in enumerate(series):
        aligned[start + offset] = value
    return aligned


def emas_agree(
    values: list[float],
    period: int,
    tolerance: float = 1e-8,
) -> tuple[float | None, float | None, bool]:
    primary = ema_series(values, period)
    alternate = ema_series_alternate(values, period)
    if not primary or not alternate or len(primary) != len(alternate):
        return None, None, False
    left, right = primary[-1], alternate[-1]
    return left, right, abs(left - right) <= tolerance
