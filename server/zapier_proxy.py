"""Zapier MCP proxy.

Mirrors the Inbox pattern: tools are prefixed ``zapier_``, the tool list is
cached for 60 seconds, and write-class calls need ``message_id`` plus
``approval_id``. ``ZAPIER_MCP_URL`` and ``ZAPIER_MCP_TOKEN`` are read only from
the environment and are stripped from every result.

Hyper alerts Zap: reuse the app connections already used by Inbox. The Zap
fires when a heartbeat says the spoken bias flipped, and it sends a message
through the existing inbox path. It does not open a second Zapier account and
it does not place an order.
"""

from __future__ import annotations

import json
import os
import time
import urllib.request
from typing import Any, Callable

PREFIX = "zapier_"
CACHE_SECONDS = 60
GUARDED = {"write", "delete", "outbound", "purchase"}


def zapier_enabled() -> bool:
    return bool(os.environ.get("ZAPIER_MCP_URL", "").strip())


def active_secrets() -> list[str]:
    names = ("ZAPIER_MCP_TOKEN", "MCP_API_KEY", "ELEVENLABS_API_KEY", "YOUTUBE_API_KEY")
    return [os.environ[name].strip() for name in names if os.environ.get(name, "").strip()]


def redact(value: Any, secrets: list[str] | None = None) -> Any:
    secrets = active_secrets() if secrets is None else secrets
    if isinstance(value, str):
        for secret in secrets:
            if secret:
                value = value.replace(secret, "[redacted]")
        return value
    if isinstance(value, dict):
        return {key: redact(item, secrets) for key, item in value.items()}
    if isinstance(value, list):
        return [redact(item, secrets) for item in value]
    return value


def classify(tool_name: str, args: dict[str, Any]) -> str:
    blob = f"{tool_name} {json.dumps(args, default=str)}".lower()
    if any(word in blob for word in ("delete", "trash", "remove", "purge")):
        return "delete"
    if any(word in blob for word in ("purchase", "buy", "checkout", "place_order", "create_order")):
        return "purchase"
    if any(word in blob for word in ("send", "reply", "forward", "tweet", "sms", "outbound")):
        return "outbound"
    if any(word in blob for word in ("create", "update", "write", "insert", "upload", "edit")):
        return "write"
    return "read"


class ZapierProxy:
    def __init__(
        self,
        *,
        clock: Callable[[], float] | None = None,
        fetch_tools: Callable[[], list[dict[str, Any]]] | None = None,
        call_tool: Callable[[str, dict[str, Any]], Any] | None = None,
    ) -> None:
        self._clock = clock or time.monotonic
        self._fetch_tools = fetch_tools or _default_fetch_tools
        self._call_tool = call_tool or _default_call_tool
        self._cache: tuple[float, list[dict[str, Any]]] | None = None

    def list_tools(self) -> list[dict[str, Any]]:
        if not zapier_enabled() and self._fetch_tools is _default_fetch_tools:
            return []
        now = self._clock()
        if self._cache and now - self._cache[0] < CACHE_SECONDS:
            return self._cache[1]
        raw = self._fetch_tools()
        tools = []
        for tool in raw:
            name = str(tool.get("name") or "")
            if not name.startswith(PREFIX):
                name = PREFIX + name
            description = str(tool.get("description") or "")
            tools.append(
                {
                    "name": name,
                    "description": redact(
                        "Read is free. Write, delete, outbound, and purchase need "
                        f"message_id and approval_id. dry_run checks only. {description}"
                    ),
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "message_id": {"type": "string"},
                            "approval_id": {"type": "string"},
                            "dry_run": {"type": "boolean"},
                        },
                    },
                }
            )
        tools = redact(tools)
        self._cache = (now, tools)
        return tools

    def call(self, prefixed: str, raw_args: dict[str, Any], approvals: Any) -> dict[str, Any]:
        name = prefixed[len(PREFIX) :] if prefixed.startswith(PREFIX) else prefixed
        args = dict(raw_args or {})
        message_id = _clean_id(args.pop("message_id", None))
        approval_id = _clean_id(args.pop("approval_id", None))
        dry = args.pop("dry_run", False) is True
        risk = classify(name, args)
        if risk in GUARDED:
            if not message_id or not approval_id:
                return _blocked("message_id and approval_id are required", dry_run=dry, risk=risk)
            row = approvals.get(approval_id) if approvals is not None else None
            if not row or row.get("status") != "approved" or row.get("message_id") != message_id:
                return _blocked("approval is not granted for this message", dry_run=dry, risk=risk)
            if dry:
                return redact(
                    {
                        "ok": True,
                        "dry_run": True,
                        "allowed": True,
                        "executed": False,
                        "risk": risk,
                        "order_sent": False,
                    }
                )
            # Even an approved row does not place an exchange order. The proxy
            # may forward the Zapier call; Hyper still has no live-order tool.
        if dry:
            return redact({"ok": True, "dry_run": True, "allowed": True, "executed": False, "risk": risk})
        if not zapier_enabled() and self._call_tool is _default_call_tool:
            return _blocked("Zapier proxy is not configured", dry_run=False, risk=risk)
        try:
            result = self._call_tool(name, args)
        except Exception as exc:
            return _blocked(str(exc), dry_run=False, risk=risk)
        return redact({"ok": True, "dry_run": False, "risk": risk, "result": result, "order_sent": False})


def _clean_id(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _blocked(reason: str, *, dry_run: bool, risk: str) -> dict[str, Any]:
    return redact(
        {
            "ok": False,
            "dry_run": dry_run,
            "allowed": False,
            "executed": False,
            "risk": risk,
            "error": reason,
            "order_sent": False,
        }
    )


def _default_fetch_tools() -> list[dict[str, Any]]:
    payload = _rpc("tools/list", {})
    tools = payload.get("tools") if isinstance(payload, dict) else None
    return list(tools or [])


def _default_call_tool(name: str, args: dict[str, Any]) -> Any:
    return _rpc("tools/call", {"name": name, "arguments": args})


def _rpc(method: str, params: dict[str, Any]) -> dict[str, Any]:
    url = os.environ.get("ZAPIER_MCP_URL", "").strip()
    if not url:
        raise RuntimeError("Zapier proxy is not configured")
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    token = os.environ.get("ZAPIER_MCP_TOKEN", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=20) as response:  # noqa: S310
        data = json.loads(response.read().decode())
    if not isinstance(data, dict):
        raise RuntimeError("Zapier returned an unexpected payload")
    if data.get("error"):
        raise RuntimeError("Zapier tool call failed")
    result = data.get("result")
    return result if isinstance(result, dict) else {"result": result}
