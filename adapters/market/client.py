"""Public market data through CCXT.

Paper trading only. The client is built with public options only and it
does not call order endpoints. Missing data comes back empty with a reason.
"""

from __future__ import annotations

import os
import time
from typing import Any, Callable

DEFAULT_SYMBOL = "BTC/USDT"
ALLOWED_TIMEFRAMES = ("1h", "4h", "1d")
CACHE_TTL_SECONDS = 30
PUBLIC_OPTIONS = {"enableRateLimit": True}


def empty_branch(error: str, **extra: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {"ok": False, "error": error}
    payload.update(extra)
    return payload


class MarketClient:
    """Thin wrapper around a CCXT exchange instance."""

    def __init__(
        self,
        exchange: Any,
        *,
        clock: Callable[[], float] | None = None,
        ttl: float = CACHE_TTL_SECONDS,
    ) -> None:
        self.exchange = exchange
        self._clock = clock or time.monotonic
        self._ttl = ttl
        self._cache: dict[tuple[Any, ...], tuple[float, dict[str, Any]]] = {}

    def _supports(self, feature: str) -> bool:
        has = getattr(self.exchange, "has", None) or {}
        return bool(has.get(feature))

    def _cached(self, key: tuple[Any, ...], loader: Callable[[], dict[str, Any]]) -> dict[str, Any]:
        now = self._clock()
        hit = self._cache.get(key)
        if hit is not None and now - hit[0] < self._ttl:
            return hit[1]
        value = loader()
        if value.get("ok"):
            self._cache[key] = (now, value)
        return value

    def fetch_ohlcv(
        self,
        symbol: str = DEFAULT_SYMBOL,
        timeframe: str = "1h",
        limit: int = 300,
    ) -> dict[str, Any]:
        if timeframe not in ALLOWED_TIMEFRAMES:
            return empty_branch(
                f"timeframe {timeframe} is not enabled",
                symbol=symbol,
                timeframe=timeframe,
                candles=[],
            )
        limit = max(1, min(int(limit), 1000))

        def load() -> dict[str, Any]:
            try:
                rows = self.exchange.fetch_ohlcv(symbol, timeframe, limit=limit)
            except Exception as exc:
                return empty_branch(str(exc), symbol=symbol, timeframe=timeframe, candles=[])
            candles = []
            for row in rows or []:
                if not row or len(row) < 6:
                    continue
                candles.append(
                    {
                        "time": int(row[0]),
                        "open": float(row[1]),
                        "high": float(row[2]),
                        "low": float(row[3]),
                        "close": float(row[4]),
                        "volume": float(row[5]),
                    }
                )
            return {"ok": True, "symbol": symbol, "timeframe": timeframe, "candles": candles}

        return self._cached(("ohlcv", symbol, timeframe, limit), load)

    def fetch_ticker(self, symbol: str = DEFAULT_SYMBOL) -> dict[str, Any]:
        def load() -> dict[str, Any]:
            try:
                data = self.exchange.fetch_ticker(symbol)
            except Exception as exc:
                return empty_branch(str(exc), symbol=symbol, last=None, change_24h=None)
            if not isinstance(data, dict) or data.get("last") is None:
                return empty_branch("ticker has no last price", symbol=symbol, last=None, change_24h=None)
            return {
                "ok": True,
                "symbol": symbol,
                "last": data.get("last"),
                "change_24h": data.get("percentage"),
            }

        return self._cached(("ticker", symbol), load)

    def fetch_funding_rate(self, symbol: str = DEFAULT_SYMBOL) -> dict[str, Any]:
        if not self._supports("fetchFundingRate"):
            return empty_branch(
                "exchange does not support fetchFundingRate",
                symbol=symbol,
                funding_rate=None,
            )
        try:
            data = self.exchange.fetch_funding_rate(symbol)
        except Exception as exc:
            return empty_branch(str(exc), symbol=symbol, funding_rate=None)
        if not isinstance(data, dict) or data.get("fundingRate") is None:
            return empty_branch("funding rate missing", symbol=symbol, funding_rate=None)
        return {"ok": True, "symbol": symbol, "funding_rate": data.get("fundingRate")}

    def fetch_open_interest(self, symbol: str = DEFAULT_SYMBOL) -> dict[str, Any]:
        if not self._supports("fetchOpenInterest"):
            return empty_branch(
                "exchange does not support fetchOpenInterest",
                symbol=symbol,
                open_interest=None,
            )
        try:
            data = self.exchange.fetch_open_interest(symbol)
        except Exception as exc:
            return empty_branch(str(exc), symbol=symbol, open_interest=None)
        if not isinstance(data, dict):
            return empty_branch("open interest payload was not an object", symbol=symbol, open_interest=None)
        amount = data.get("openInterestAmount")
        if amount is None:
            amount = data.get("openInterest")
        if amount is None:
            return empty_branch("open interest missing", symbol=symbol, open_interest=None)
        return {"ok": True, "symbol": symbol, "open_interest": amount}

    def fetch_liquidations(self, symbol: str = DEFAULT_SYMBOL) -> dict[str, Any]:
        if not self._supports("fetchLiquidations"):
            return empty_branch(
                "exchange does not expose liquidations",
                symbol=symbol,
                liquidations=[],
            )
        try:
            rows = self.exchange.fetch_liquidations(symbol)
        except Exception as exc:
            return empty_branch(str(exc), symbol=symbol, liquidations=[])
        cleaned: list[Any] = []
        for row in rows or []:
            if isinstance(row, dict):
                cleaned.append(
                    {key: row.get(key) for key in ("timestamp", "side", "price", "amount") if key in row}
                )
            else:
                cleaned.append(row)
        payload: dict[str, Any] = {"ok": True, "symbol": symbol, "liquidations": cleaned}
        if not cleaned:
            payload["reason"] = "exchange returned no liquidation rows"
        return payload


def build_exchange(exchange_id: str | None = None) -> Any:
    """Build a public CCXT exchange. Credentials are not passed in."""

    import ccxt

    name = (exchange_id or os.environ.get("EXCHANGE_ID") or "binance").strip()
    if not name or not hasattr(ccxt, name):
        raise ValueError(f"unknown exchange id: {name}")
    return getattr(ccxt, name)(dict(PUBLIC_OPTIONS))
