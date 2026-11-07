"""HTTP entrypoint. Binds 0.0.0.0 and $PORT. Paper trading only."""

from __future__ import annotations

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from server.auth import auth_configured, extract_key, key_ok
from server.mcp import handle_rpc
from server.service import HyperService
from server.speak import speak_plan, synthesize
from server.zapier_proxy import redact

WEB_FILES = {
    "/": "index.html",
    "/index.html": "index.html",
    "/styles.css": "styles.css",
    "/app.js": "app.js",
    "/spoken.js": "spoken.js",
}
CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
}


class HyperHandler(BaseHTTPRequestHandler):
    server: HyperServer

    def log_message(self, fmt: str, *args: Any) -> None:
        # Avoid writing request targets that may carry ?key=.
        return

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self._send_json(
                200,
                {"ok": True, "paper_only": True, "service": "hyper", "auth_configured": auth_configured()},
            )
            return
        if parsed.path == "/api/confluence":
            if not self._authorized(parsed.query):
                return
            symbol = (parse_qs(parsed.query).get("symbol") or ["BTC/USDT"])[0]
            self._send_json(200, self.server.service.get_confluence(symbol))
            return
        if parsed.path in WEB_FILES:
            self._send_file(WEB_FILES[parsed.path])
            return
        self._send_json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if not self._authorized(parsed.query):
            return
        body = self._read_json()
        if body is None:
            self._send_json(400, {"error": "invalid json"})
            return
        if parsed.path == "/mcp":
            if not isinstance(body, dict):
                self._send_json(400, {"error": "json-rpc object required"})
                return
            response = handle_rpc(body, self.server.service)
            if response is None:
                self.send_response(202)
                self.end_headers()
                return
            self._send_json(200, response)
            return
        if parsed.path == "/api/messages":
            text = body.get("text") if isinstance(body, dict) else None
            if not isinstance(text, str) or not text.strip():
                self._send_json(400, {"error": "text required"})
                return
            agent = body.get("agent") if isinstance(body, dict) else None
            message = self.server.service.create_message(text, agent if isinstance(agent, str) else None)
            self._send_json(201, {"message": message})
            return
        if parsed.path == "/api/speak":
            text = body.get("text") if isinstance(body, dict) else ""
            if not isinstance(text, str) or not text.strip():
                plan = self.server.service.speak_confluence()
                text = str(plan.get("text") or "")
            else:
                self.server.service.remember_spoken(text)
            self._send_json(200, speak_plan(text))
            return
        if parsed.path == "/api/speak/audio":
            spoken = (self.server.service.last_report or {}).get("spoken") or ""
            audio, reason = synthesize(str(spoken))
            if audio is None:
                self._send_json(200, {"mode": "browser", "text": spoken, "detail": reason, "order_sent": False})
                return
            self.send_response(200)
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("Content-Length", str(len(audio)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(audio)
            return
        self._send_json(404, {"error": "not found"})

    def _authorized(self, query: str) -> bool:
        query_key = (parse_qs(query).get("key") or [None])[0]
        headers = {name: value for name, value in self.headers.items()}
        if key_ok(extract_key(headers, query_key)):
            return True
        status = 500 if not auth_configured() else 401
        self._send_json(status, {"error": "unauthorized" if status == 401 else "server misconfigured"})
        return False

    def _read_json(self) -> Any:
        length = int(self.headers.get("Content-Length") or "0")
        raw = self.rfile.read(length) if length else b""
        if not raw:
            return {}
        try:
            return json.loads(raw.decode())
        except json.JSONDecodeError:
            return None

    def _send_json(self, status: int, payload: Any) -> None:
        data = json.dumps(redact(payload)).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _send_file(self, name: str) -> None:
        path = self.server.service.root / "web" / name
        if not path.is_file():
            self._send_json(404, {"error": "not found"})
            return
        data = path.read_bytes()
        suffix = path.suffix
        self.send_response(200)
        self.send_header("Content-Type", CONTENT_TYPES.get(suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)


class HyperServer(ThreadingHTTPServer):
    def __init__(self, server_address: tuple[str, int], service: HyperService) -> None:
        self.service = service
        super().__init__(server_address, HyperHandler)


def make_server(service: HyperService, host: str = "127.0.0.1", port: int = 0) -> HyperServer:
    return HyperServer((host, port), service)


def _heartbeat_loop(service: HyperService, interval: int) -> None:
    while True:
        threading.Event().wait(interval)
        try:
            service.run_heartbeat()
        except Exception:
            continue


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    service = HyperService(root=root)
    host = "0.0.0.0"
    port = int(os.environ.get("PORT", "8080"))
    interval = int(os.environ.get("HYPER_HEARTBEAT_SECONDS", str(30 * 60)))
    thread = threading.Thread(target=_heartbeat_loop, args=(service, interval), daemon=True)
    thread.start()
    server = make_server(service, host, port)
    print(f"Hyper paper-only MCP on http://{host}:{port}", flush=True)
    server.serve_forever()
