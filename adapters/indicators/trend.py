"""200 EMA is the trend filter. 50 EMA and 50 SMA are tracked beside it."""

from __future__ import annotations

from typing import Any

from adapters.indicators.common import hollow, num
from adapters.indicators.ema import emas_agree
from adapters.indicators.sma import sma_last


def trend_branch(closes: list[float]) -> dict[str, Any]:
    if len(closes) < 200:
        return hollow(f"need 200 closes for the 200 EMA, have {len(closes)}")
    ema200, ema200_check, agree = emas_agree(closes, 200)
    if not agree or ema200 is None or ema200_check is None:
        return hollow("200 EMA methods disagree", contradiction=True, ema_a=ema200, ema_b=ema200_check)
    close = closes[-1]
    if close > ema200:
        side = "long"
        relation = "above"
    elif close < ema200:
        side = "short"
        relation = "below"
    else:
        side = "neutral"
        relation = "equal to"
    ema50, ema50_check, agree50 = emas_agree(closes, 50)
    if not agree50 or ema50 is None:
        return hollow("50 EMA methods disagree", contradiction=True, ema_a=ema50, ema_b=ema50_check)
    sma50 = sma_last(closes, 50)
    if sma50 is None:
        return hollow("need 50 closes for the 50 SMA")
    ema50_side = "long" if close > ema50 else "short" if close < ema50 else "neutral"
    tension = ema50_side in ("long", "short") and side in ("long", "short") and ema50_side != side
    reason = (
        f"close {num(close)} is {relation} the 200 EMA {num(ema200)}. "
        f"50 EMA {num(ema50)}, 50 SMA {num(sma50)}."
    )
    if tension:
        reason += " The 50 EMA disagrees with the 200 EMA. The branch follows the 200 EMA and does not average them."
    return {
        "empty": False,
        "side": side,
        "reason": reason,
        "value": ema200,
        "ema200": ema200,
        "ema50": ema50,
        "sma50": sma50,
        "tension": tension,
        "contradiction": False,
    }
