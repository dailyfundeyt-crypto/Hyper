from adapters.indicators.confluence import build_confluence, parse_open_idea
from adapters.indicators.divergence import divergence_on_swings
from adapters.indicators.ema import ema_last, emas_agree
from adapters.indicators.fvg import latest_fvg
from adapters.indicators.macd import MACD_FAST, MACD_SIGNAL, MACD_SLOW, macd_last
from adapters.indicators.momentum import momentum_branch
from adapters.indicators.rsi import rsi_last
from adapters.indicators.sma import sma_last
from adapters.indicators.stoch_rsi import stoch_of_window, stochastic_rsi
from adapters.indicators.structure import structure_branch
from adapters.indicators.trend import trend_branch


def candle(index, high, low, close):
    return {
        "time": index,
        "open": close,
        "high": high,
        "low": low,
        "close": close,
        "volume": 1,
    }


def test_sma_and_ema_match_hand_math():
    assert sma_last([1, 2, 3, 4, 5], 3) == 4
    assert sma_last([1, 2, 3], 50) is None
    values = [float(item) for item in range(1, 11)]
    assert ema_last(values, 3) == 9
    left, right, agree = emas_agree(values, 3)
    assert agree is True
    assert left == right == 9


def test_rsi_hand_values():
    assert rsi_last([10, 12, 11, 13], 3) == 80
    assert rsi_last([10, 11, 12, 13], 3) == 100
    assert rsi_last([1, 2], 14) is None


def test_macd_defaults_and_histogram():
    assert (MACD_FAST, MACD_SLOW, MACD_SIGNAL) == (12, 26, 9)
    values = [float(item) for item in range(1, 40)]
    result = macd_last(values, fast=3, slow=6, signal=3)
    assert result is not None
    assert result["histogram"] == result["macd"] - result["signal"]
    assert macd_last([1, 2, 3]) is None


def test_stochastic_window_and_flat_series():
    assert stoch_of_window([10, 20, 30, 40, 50]) == 100
    assert stoch_of_window([50, 40, 30, 20, 10]) == 0
    assert stoch_of_window([5, 5, 5]) is None
    flat = stochastic_rsi([100.0] * 80)
    assert flat["empty"] is True


def test_trend_follows_the_200_ema_and_stays_hollow_when_short():
    rising = [100.0] * 219 + [110.0]
    falling = [100.0] * 219 + [90.0]
    assert trend_branch(rising)["side"] == "long"
    assert trend_branch(falling)["side"] == "short"
    short = trend_branch([100.0] * 40)
    assert short["empty"] is True
    assert short["value"] is None
    assert "200" in short["reason"]


def test_bullish_divergence_and_fvg_use_the_bars_given():
    price = [5, 1, 4, 3, 0.5, 4]
    oscillator = [None, 20.0, None, None, 30.0, None]
    found = divergence_on_swings(price, oscillator, bullish=True)
    assert found["side"] == "long"
    assert found["price"] == (1, 0.5)
    gap = latest_fvg(
        [
            candle(0, 10, 8, 9),
            candle(1, 12, 9, 11),
            candle(2, 14, 11, 13),
        ]
    )
    assert gap["side"] == "long"
    assert gap["bottom"] == 10
    assert gap["top"] == 11
    assert latest_fvg([candle(0, 10, 9, 9.5), candle(1, 10, 9, 9.5)])["empty"] is True


def test_structure_flags_a_break_without_inventing_a_level():
    candles = [
        candle(0, 10, 8, 9),
        candle(1, 14, 11, 12),
        candle(2, 11, 9, 10),
        candle(3, 12, 7, 8),
        candle(4, 13, 10, 12),
        candle(5, 16, 12, 15),
        candle(6, 14, 11, 13),
        candle(7, 15, 9, 10),
        candle(8, 18, 14, 17),
    ]
    result = structure_branch(candles)
    assert result["empty"] is False
    assert result["value"] is not None
    assert "need" not in result["reason"]
    assert structure_branch([candle(0, 1, 1, 1)])["empty"] is True


def test_momentum_does_not_trade_a_stochastic_flag():
    closes = [float(item) for item in range(1, 80)]
    result = momentum_branch(closes)
    assert "order" not in result["reason"] or "not an order" in result["reason"]
    assert result["side"] in {"long", "short", "neutral", None}


def test_confluence_without_candles_invents_nothing():
    report = build_confluence("BTC/USDT", [], ohlcv_error="venue down")
    assert report["paper_only"] is True
    assert report["order_sent"] is False
    assert report["tilt"] == {"long": 0, "short": 0}
    assert report["bias"] is None
    assert [branch["name"] for branch in report["branches"]] == [
        "Sentiment",
        "Fundamental",
        "Sector",
        "Trend",
        "Momentum",
        "Divergence",
        "Structure",
        "Macro",
    ]
    assert all(branch["empty"] for branch in report["branches"])
    blob = str(report)
    assert "42000" not in blob
    assert "No order was sent" in report["spoken"]
    assert "venue down" in report["branches"][3]["detail"]


def test_alarm_when_two_branches_flip_against_the_previous_reading():
    candles = [candle(index, 100 + index, 90 + index, 95 + index) for index in range(220)]
    first = build_confluence("BTC/USDT", candles)
    previous = {branch["name"]: branch["side"] for branch in first["branches"]}
    previous["Trend"] = "short" if first["branches"][3]["side"] == "long" else "long"
    previous["Momentum"] = "short" if first["branches"][4]["side"] == "long" else "long"
    second = build_confluence("BTC/USDT", candles, previous_sides=previous)
    assert len(second["flips"]) >= 2
    assert second["alarm"] is True
    assert "No order was sent" in second["spoken"]


def test_open_idea_template_is_not_a_side():
    text = "- Symbol:\n- Side:\n- Invalidation:\n"
    assert parse_open_idea(text)["side"] is None
    filled = parse_open_idea("- Symbol: BTC/USDT\n- Side: short\n- Invalidation: 100\n")
    assert filled == {"symbol": "BTC/USDT", "side": "short", "invalidation": "100"}
