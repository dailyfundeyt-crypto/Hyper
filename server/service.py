"""Paper-only operations behind the MCP tools and the HTTP routes."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from adapters.indicators.confluence import build_confluence, parse_open_idea
from adapters.market.client import DEFAULT_SYMBOL, MarketClient, build_exchange, empty_branch

from server.ask import ask, list_identities
from server.books import ApprovalBook, MessageBook
from server.speak import speak_plan
from server.zapier_proxy import PREFIX, ZapierProxy

INSTRUCTIONS = (
    "Hyper is paper trading only. No live orders. "
    "get_confluence returns a hollow branch when a reading is missing. "
    "Do not invent a number. "
    "Zapier tools are prefixed zapier_. "
    "Write, delete, outbound, and purchase tools need message_id and approval_id. "
    "The owner key is not part of MCP auth."
)

OPEN_IDEA = Path("brain") / "Arbeiten" / "Arbeit – Open Idea.md"
SPOKEN = Path("brain") / "Ergebnisse" / "Ergebnis – Letzter Spruch.md"


class HyperService:
    def __init__(self, root: Path | None = None, market: MarketClient | None = None) -> None:
        self.root = root or Path(__file__).resolve().parents[1]
        self.market = market
        self.messages = MessageBook()
        self.approvals = ApprovalBook()
        self.zapier = ZapierProxy()
        self.last_report: dict[str, Any] | None = None
        self.prev_sides: dict[str, str | None] | None = None

    def market_client(self) -> MarketClient:
        if self.market is None:
            self.market = MarketClient(build_exchange())
        return self.market

    def get_ohlcv(self, symbol: str = DEFAULT_SYMBOL, timeframe: str = "1h", limit: int = 300) -> dict[str, Any]:
        try:
            return self.market_client().fetch_ohlcv(symbol, timeframe, limit)
        except Exception as exc:
            return empty_branch(str(exc), symbol=symbol, timeframe=timeframe, candles=[])

    def get_ticker(self, symbol: str = DEFAULT_SYMBOL) -> dict[str, Any]:
        try:
            return self.market_client().fetch_ticker(symbol)
        except Exception as exc:
            return empty_branch(str(exc), symbol=symbol, last=None, change_24h=None)

    def _open_idea(self) -> dict[str, Any]:
        path = self.root / OPEN_IDEA
        if not path.is_file():
            return {"symbol": None, "side": None, "invalidation": None}
        return parse_open_idea(path.read_text(encoding="utf-8"))

    def get_confluence(self, symbol: str = DEFAULT_SYMBOL) -> dict[str, Any]:
        ohlcv = self.get_ohlcv(symbol, "1h", 300)
        candles = ohlcv.get("candles") or []
        error = None if ohlcv.get("ok") else ohlcv.get("error") or "no candles"
        report = build_confluence(
            symbol,
            candles,
            ohlcv_error=error,
            open_idea=self._open_idea(),
            previous_sides=self.prev_sides,
        )
        self.prev_sides = {branch["name"]: branch["side"] for branch in report["branches"]}
        self.last_report = report
        return report

    def run_heartbeat(self, symbol: str = DEFAULT_SYMBOL) -> dict[str, Any]:
        report = self.get_confluence(symbol)
        self._save_spoken(report)
        return {"ok": True, "paper_only": True, "order_sent": False, "confluence": report}

    def speak_confluence(self, symbol: str = DEFAULT_SYMBOL) -> dict[str, Any]:
        report = self.last_report if self.last_report and self.last_report.get("symbol") == symbol else None
        if report is None:
            report = self.get_confluence(symbol)
        self._save_spoken(report)
        plan = speak_plan(report.get("spoken") or "")
        plan["paper_only"] = True
        plan["order_sent"] = False
        return plan

    def remember_spoken(self, text: str) -> None:
        report = dict(self.last_report or {"spoken": text})
        report["spoken"] = text
        self._save_spoken(report)

    def _save_spoken(self, report: dict[str, Any]) -> None:
        override = os.environ.get("HYPER_SPOKEN_FILE", "").strip()
        path = Path(override) if override else self.root / SPOKEN
        spoken = report.get("spoken") or ""
        body = (
            "# Ergebnis – Letzter Spruch\n\n"
            f"{spoken}\n\n"
            "Paper only. No order was sent.\n"
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding="utf-8")

    def create_message(self, text: str, agent: str | None) -> dict[str, Any]:
        return self.messages.create(text, agent or "hyper")

    def request_approval(self, message_id: str, action: str, summary: str) -> dict[str, Any]:
        row = self.approvals.request(message_id, action, summary)
        row["order_sent"] = False
        row["note"] = "Pending only. MCP auth cannot approve, and this does not place an order."
        return row

    def ask(self, text: str, identity: str | None = None) -> dict[str, Any]:
        return ask(text, identity, self.root)

    def list_identities(self) -> list[dict[str, str]]:
        return list_identities(self.root)

    def tool_specs(self) -> list[dict[str, Any]]:
        specs = [
            _tool("get_ohlcv", "Public OHLCV. Returns empty candles and an error string on failure.", {
                "symbol": {"type": "string"},
                "timeframe": {"type": "string", "enum": ["1h", "4h", "1d"]},
                "limit": {"type": "integer"},
            }),
            _tool("get_confluence", "Long/short tilt for each branch. Hollow when there is no reading.", {
                "symbol": {"type": "string"},
            }),
            _tool("ask", "Load an identity prompt. Security is a gate and does not vote.", {
                "text": {"type": "string"},
                "identity": {"type": "string"},
            }),
            _tool("run_heartbeat", "Refresh public market data and confluence. Paper only.", {
                "symbol": {"type": "string"},
            }),
            _tool("list_identities", "List identity prompts.", {}),
            _tool("speak_confluence", "Return the spoken script. Does not claim an order was sent.", {
                "symbol": {"type": "string"},
            }),
            _tool(
                "request_approval",
                "Record a pending approval for a future write. Does not place an order.",
                {
                    "message_id": {"type": "string"},
                    "action": {"type": "string"},
                    "summary": {"type": "string"},
                },
            ),
        ]
        specs.extend(self.zapier.list_tools())
        return specs

    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        arguments = arguments or {}
        if name.startswith(PREFIX):
            return self.zapier.call(name, arguments, self.approvals)
        if name == "get_ohlcv":
            return self.get_ohlcv(
                arguments.get("symbol") or DEFAULT_SYMBOL,
                arguments.get("timeframe") or "1h",
                int(arguments.get("limit") or 300),
            )
        if name == "get_confluence":
            return self.get_confluence(arguments.get("symbol") or DEFAULT_SYMBOL)
        if name == "ask":
            return self.ask(str(arguments.get("text") or ""), arguments.get("identity"))
        if name == "run_heartbeat":
            return self.run_heartbeat(arguments.get("symbol") or DEFAULT_SYMBOL)
        if name == "list_identities":
            return {"identities": self.list_identities(), "paper_only": True}
        if name == "speak_confluence":
            return self.speak_confluence(arguments.get("symbol") or DEFAULT_SYMBOL)
        if name == "request_approval":
            message_id = str(arguments.get("message_id") or "").strip()
            action = str(arguments.get("action") or "").strip()
            summary = str(arguments.get("summary") or "").strip()
            if not message_id or not action or not summary:
                return {"ok": False, "error": "message_id, action, and summary are required", "order_sent": False}
            return self.request_approval(message_id, action, summary)
        return {"ok": False, "error": f"unknown tool {name}", "order_sent": False}


def _tool(name: str, description: str, properties: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": name,
        "description": description,
        "inputSchema": {"type": "object", "properties": properties, "additionalProperties": False},
    }
