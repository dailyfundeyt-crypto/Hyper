"""JSON-RPC MCP methods used by the Inbox-compatible HTTP route."""

from __future__ import annotations

import json
from typing import Any

from server.service import INSTRUCTIONS, HyperService
from server.zapier_proxy import redact

SUPPORTED_PROTOCOLS = ("2026-07-28", "2025-06-18", "2025-03-26", "2024-11-05")
DEFAULT_PROTOCOL = "2025-06-18"
SERVER_INFO = {"name": "hyper", "version": "0.1.0"}


def handle_rpc(message: dict[str, Any], service: HyperService) -> dict[str, Any] | None:
    method = message.get("method")
    rpc_id = message.get("id")
    params = message.get("params") if isinstance(message.get("params"), dict) else {}
    if method == "notifications/initialized":
        return None
    if method == "ping":
        return _result(rpc_id, {})
    if method == "initialize":
        requested = str(params.get("protocolVersion") or DEFAULT_PROTOCOL)
        protocol = requested if requested in SUPPORTED_PROTOCOLS else DEFAULT_PROTOCOL
        return _result(
            rpc_id,
            {
                "protocolVersion": protocol,
                "capabilities": {"tools": {}},
                "serverInfo": SERVER_INFO,
                "instructions": INSTRUCTIONS,
            },
        )
    if method == "tools/list":
        return _result(rpc_id, {"tools": service.tool_specs()})
    if method == "tools/call":
        name = str(params.get("name") or "")
        arguments = params.get("arguments") if isinstance(params.get("arguments"), dict) else {}
        payload = service.call_tool(name, arguments)
        text = json.dumps(redact(payload), default=str)
        return _result(
            rpc_id,
            {
                "content": [{"type": "text", "text": text}],
                "isError": bool(isinstance(payload, dict) and payload.get("ok") is False),
            },
        )
    return _error(rpc_id, -32601, "method not found")


def _result(rpc_id: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": rpc_id, "result": redact(result)}


def _error(rpc_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": rpc_id, "error": {"code": code, "message": message}}
