"""Assemble the eight confluence branches. Hollow stays hollow."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from adapters.indicators.common import hollow
from adapters.indicators.divergence import divergence_branch
from adapters.indicators.momentum import momentum_branch
from adapters.indicators.structure import structure_branch
from adapters.indicators.trend import trend_branch

BERLIN = ZoneInfo("Europe/Berlin")
BRANCH_ORDER = (
    "Sentiment",
    "Fundamental",
    "Sector",
    "Trend",
    "Momentum",
    "Divergence",
    "Structure",
    "Macro",
)


def berlin_now() -> str:
    return datetime.now(BERLIN).isoformat(timespec="seconds")


def parse_open_idea(text: str) -> dict[str, str | None]:
    found: dict[str, str | None] = {"symbol": None, "side": None, "invalidation": None}
    for line in text.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip().lstrip("-").strip().lower()
        value = value.strip()
        if key not in found or not value or "|" in value:
            continue
        if key == "side" and value.lower() not in {"long", "short", "flat"}:
            continue
        found[key] = value.lower() if key == "side" else value
    return found


def branch_view(name: str, result: dict[str, Any], source: str) -> dict[str, Any]:
    contradiction = bool(result.get("contradiction"))
    side = result.get("side")
    has_side = side in ("long", "short", "neutral") and not result.get("empty") and not contradiction
    detail = result.get("reason") or "no data"
    if not has_side:
        return {
            "name": name,
            "side": None,
            "state": "contradiction" if contradiction else "empty",
            "empty": True,
            "reason": detail if contradiction else "no data",
            "detail": detail,
            "source": source,
        }
    return {
        "name": name,
        "side": side,
        "state": side,
        "empty": False,
        "reason": detail,
        "detail": detail,
        "source": source,
    }


def _safe(fn: Any, *args: Any) -> dict[str, Any]:
    try:
        result = fn(*args)
    except Exception as exc:
        return hollow(str(exc))
    if not isinstance(result, dict):
        return hollow("indicator returned no reading")
    return result


def spoken_script(report: dict[str, Any]) -> str:
    symbol = report["symbol"]
    tilt = report["tilt"]
    lines = [
        (
            f"Paper only. No order was sent. {symbol} has "
            f"{tilt['long']} long and {tilt['short']} short."
        )
    ]
    flips = report.get("flips") or []
    if flips:
        lines.append("Branches that flipped: " + ", ".join(flips) + ".")
    else:
        filled = [branch["name"] for branch in report["branches"] if not branch["empty"]]
        if filled:
            lines.append("Branches with a reading: " + ", ".join(filled) + ".")
        else:
            lines.append("No branch has a reading.")
    idea = report.get("open_idea") or {}
    bias = report.get("bias")
    idea_side = idea.get("side")
    if idea_side in ("long", "short") and bias in ("long", "short"):
        if idea_side != bias:
            lines.append(f"The bias fights the open {idea_side} idea.")
        else:
            lines.append(f"The bias agrees with the open {idea_side} idea.")
    else:
        lines.append("There is no open idea to compare.")
    if report.get("alarm"):
        warning = "This is a warning only."
        if len(lines) >= 4:
            lines[3] = lines[3] + " " + warning
        else:
            lines.append(warning)
    text = " ".join(lines[:4])
    if len(text) > 420:
        text = text[:417].rstrip() + "."
    return text


def build_confluence(
    symbol: str,
    candles: list[dict[str, Any]] | None,
    *,
    ohlcv_error: str | None = None,
    open_idea: dict[str, Any] | None = None,
    previous_sides: dict[str, str | None] | None = None,
    now: str | None = None,
) -> dict[str, Any]:
    """Score each branch long, short, neutral, or hollow. Never invent a missing number."""

    candles = list(candles or [])
    closes = [float(candle["close"]) for candle in candles]
    sourced = bool(candles) and not ohlcv_error
    if sourced:
        technical = {
            "Trend": (_safe(trend_branch, closes), "adapters.indicators.trend"),
            "Momentum": (_safe(momentum_branch, closes), "adapters.indicators.momentum"),
            "Divergence": (_safe(divergence_branch, candles), "adapters.indicators.divergence"),
            "Structure": (_safe(structure_branch, candles), "adapters.indicators.structure"),
        }
    else:
        detail = ohlcv_error or "no candles"
        technical = {
            name: (hollow(detail), source)
            for name, source in (
                ("Trend", "adapters.indicators.trend"),
                ("Momentum", "adapters.indicators.momentum"),
                ("Divergence", "adapters.indicators.divergence"),
                ("Structure", "adapters.indicators.structure"),
            )
        }
    context = {
        "Sentiment": hollow("no sentiment source is configured"),
        "Fundamental": hollow("no fundamental source is configured"),
        "Sector": hollow("no sector source is configured"),
        "Macro": hollow("no macro source is configured"),
    }
    branches = []
    for name in BRANCH_ORDER:
        if name in technical:
            result, source = technical[name]
            branches.append(branch_view(name, result, source))
        else:
            branches.append(branch_view(name, context[name], "none"))
    longs = sum(1 for branch in branches if branch["side"] == "long")
    shorts = sum(1 for branch in branches if branch["side"] == "short")
    if longs > shorts:
        bias: str | None = "long"
    elif shorts > longs:
        bias = "short"
    elif longs == 0 and shorts == 0:
        bias = None
    else:
        bias = "neutral"
    flips: list[str] = []
    if previous_sides:
        for branch in branches:
            previous = previous_sides.get(branch["name"])
            current = branch["side"]
            if previous in ("long", "short") and current in ("long", "short") and previous != current:
                flips.append(branch["name"])
    idea = open_idea or {"symbol": None, "side": None, "invalidation": None}
    fights = idea.get("side") in ("long", "short") and bias in ("long", "short") and idea.get("side") != bias
    report: dict[str, Any] = {
        "symbol": symbol,
        "paper_only": True,
        "timeframe": "1h",
        "heartbeat_at": now or berlin_now(),
        "timezone": "Europe/Berlin",
        "tilt": {"long": longs, "short": shorts},
        "bias": bias,
        "branches": branches,
        "open_idea": idea,
        "flips": flips,
        "alarm": bool(fights or len(flips) >= 2),
        "order_sent": False,
    }
    report["spoken"] = spoken_script(report)
    return report
