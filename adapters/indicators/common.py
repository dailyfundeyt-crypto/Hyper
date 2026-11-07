"""Shared helpers for indicator branches."""

from __future__ import annotations

from typing import Any


def hollow(reason: str, **extra: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "empty": True,
        "side": None,
        "reason": reason,
        "value": None,
        "contradiction": False,
    }
    payload.update(extra)
    return payload


def closes_of(candles: list[dict[str, Any]]) -> list[float]:
    return [float(candle["close"]) for candle in candles]


def highs_of(candles: list[dict[str, Any]]) -> list[float]:
    return [float(candle["high"]) for candle in candles]


def lows_of(candles: list[dict[str, Any]]) -> list[float]:
    return [float(candle["low"]) for candle in candles]


def num(value: float) -> str:
    return format(value, ".8g")
