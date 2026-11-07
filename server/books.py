"""In-memory inbox messages and approval stubs. No exchange orders."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4


class MessageBook:
    def __init__(self) -> None:
        self.rows: list[dict[str, Any]] = []

    def create(self, text: str, agent: str = "hyper") -> dict[str, Any]:
        row = {
            "id": str(uuid4()),
            "text": text,
            "agent": (agent or "hyper").strip().lower() or "hyper",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        self.rows.append(row)
        return row


class ApprovalBook:
    """Stub of the Inbox purchase/approval class.

    MCP auth cannot mark a row approved. A future owner path would do that
    outside the bearer token. An approved row still does not place an order.
    """

    def __init__(self) -> None:
        self.rows: dict[str, dict[str, Any]] = {}

    def request(self, message_id: str, action: str, summary: str) -> dict[str, Any]:
        approval_id = str(uuid4())
        row = {
            "id": approval_id,
            "message_id": message_id,
            "action": action,
            "summary": summary,
            "status": "pending",
            "order_sent": False,
        }
        self.rows[approval_id] = row
        return dict(row)

    def get(self, approval_id: str) -> dict[str, Any] | None:
        row = self.rows.get(approval_id)
        return dict(row) if row else None
