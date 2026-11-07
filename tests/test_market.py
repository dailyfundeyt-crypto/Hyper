from pathlib import Path

import pytest
from adapters.market.client import PUBLIC_OPTIONS, MarketClient, build_exchange


class FakeExchange:
    def __init__(self):
        self.has = {
            "fetchOHLCV": True,
            "fetchTicker": True,
            "fetchFundingRate": False,
            "fetchOpenInterest": False,
            "fetchLiquidations": False,
        }
        self.ohlcv_calls = 0

    def fetch_ohlcv(self, symbol, timeframe="1h", limit=100, since=None):
        self.ohlcv_calls += 1
        start = 1_700_000_000_000
        rows = []
        for index in range(limit):
            price = 100 + index
            rows.append([start + index * 3_600_000, price, price + 2, price - 1, price + 0.5, 10 + index])
        return rows

    def fetch_ticker(self, symbol):
        return {"symbol": symbol, "last": 42000.5, "percentage": -1.25}

    def fetch_funding_rate(self, symbol):
        raise RuntimeError("should not be called")


class BoomExchange(FakeExchange):
    def fetch_ohlcv(self, symbol, timeframe="1h", limit=100, since=None):
        raise RuntimeError("venue down")


class FundingExchange(FakeExchange):
    def __init__(self):
        super().__init__()
        self.has["fetchFundingRate"] = True
        self.has["fetchOpenInterest"] = True
        self.has["fetchLiquidations"] = True

    def fetch_funding_rate(self, symbol):
        return {"symbol": symbol, "fundingRate": 0.0001}

    def fetch_open_interest(self, symbol):
        return {"symbol": symbol, "openInterestAmount": 1234.0}

    def fetch_liquidations(self, symbol):
        return [{"timestamp": 1, "side": "sell", "price": 100.0, "amount": 2.0, "ignored": "x"}]


def test_ohlcv_shape():
    client = MarketClient(FakeExchange(), clock=lambda: 0)
    result = client.fetch_ohlcv("BTC/USDT", "1h", limit=3)
    assert result["ok"] is True
    assert result["candles"][0] == {
        "time": 1_700_000_000_000,
        "open": 100.0,
        "high": 102.0,
        "low": 99.0,
        "close": 100.5,
        "volume": 10.0,
    }
    assert len(result["candles"]) == 3


def test_timeframe_rejected_without_a_guess():
    result = MarketClient(FakeExchange()).fetch_ohlcv("BTC/USDT", "5m")
    assert result["ok"] is False
    assert result["candles"] == []
    assert "5m" in result["error"]


def test_exchange_error_is_an_empty_branch():
    result = MarketClient(BoomExchange()).fetch_ohlcv("BTC/USDT", "1h")
    assert result["ok"] is False
    assert result["candles"] == []
    assert result["error"] == "venue down"


def test_cache_expires_after_thirty_seconds():
    now = {"t": 0.0}
    exchange = FakeExchange()
    client = MarketClient(exchange, clock=lambda: now["t"], ttl=30)
    client.fetch_ohlcv("BTC/USDT", "4h", limit=2)
    client.fetch_ohlcv("BTC/USDT", "4h", limit=2)
    assert exchange.ohlcv_calls == 1
    now["t"] = 31
    client.fetch_ohlcv("BTC/USDT", "4h", limit=2)
    assert exchange.ohlcv_calls == 2


def test_ticker_and_missing_derivatives():
    client = MarketClient(FakeExchange(), clock=lambda: 0)
    ticker = client.fetch_ticker("BTC/USDT")
    assert ticker["last"] == 42000.5
    assert ticker["change_24h"] == -1.25
    funding = client.fetch_funding_rate("BTC/USDT")
    assert funding["ok"] is False
    assert funding["funding_rate"] is None
    assert "fetchFundingRate" in funding["error"]
    interest = client.fetch_open_interest("BTC/USDT")
    assert interest["open_interest"] is None
    liquidations = client.fetch_liquidations("BTC/USDT")
    assert liquidations["liquidations"] == []
    assert "does not expose" in liquidations["error"]


def test_supported_derivatives_pass_through_rows():
    client = MarketClient(FundingExchange(), clock=lambda: 0)
    assert client.fetch_funding_rate()["funding_rate"] == 0.0001
    assert client.fetch_open_interest()["open_interest"] == 1234.0
    rows = client.fetch_liquidations()["liquidations"]
    assert rows == [{"timestamp": 1, "side": "sell", "price": 100.0, "amount": 2.0}]


def test_public_options_carry_no_credentials():
    assert PUBLIC_OPTIONS == {"enableRateLimit": True}
    with pytest.raises(ValueError):
        build_exchange("not-a-real-hyper-exchange")


def test_market_package_has_no_order_api():
    text = "\n".join(path.read_text(encoding="utf-8") for path in Path("adapters/market").glob("*.py"))
    for banned in ("create_order", "create_market_buy_order", "privatePost", "apiKey", "secret"):
        assert banned not in text
