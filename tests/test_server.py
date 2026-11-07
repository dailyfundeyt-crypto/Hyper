import json
import threading
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from adapters.market.client import MarketClient
from server.app import make_server
from server.auth import extract_key, key_ok
from server.mcp import handle_rpc
from server.service import HyperService


class SilentExchange:
    def __init__(self):
        self.has = {}

    def fetch_ohlcv(self, symbol, timeframe="1h", limit=100, since=None):
        raise RuntimeError("venue down")

    def fetch_ticker(self, symbol):
        raise RuntimeError("venue down")


def service(monkeypatch):
    monkeypatch.setenv("MCP_API_KEY", "dev-local")
    monkeypatch.delenv("ZAPIER_MCP_TOKEN", raising=False)
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    market = MarketClient(SilentExchange(), clock=lambda: 0)
    return HyperService(root=Path(".").resolve(), market=market)


def test_auth_accepts_bearer_header_and_query(monkeypatch):
    monkeypatch.setenv("MCP_API_KEY", "dev-local")
    assert key_ok(extract_key({"Authorization": "Bearer dev-local"}, None))
    assert key_ok(extract_key({"X-Api-Key": "dev-local"}, None))
    assert key_ok(extract_key({}, "dev-local"))
    assert key_ok(extract_key({"x-owner-key": "dev-local"}, None)) is False
    assert key_ok("nope") is False


def test_health_and_page_do_not_leak_secrets(monkeypatch):
    app = service(monkeypatch)
    httpd = make_server(app)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    port = httpd.server_address[1]
    try:
        with urlopen(f"http://127.0.0.1:{port}/health") as response:
            health = json.loads(response.read().decode())
        assert health["ok"] is True
        assert health["paper_only"] is True
        assert "dev-local" not in json.dumps(health)
        with urlopen(f"http://127.0.0.1:{port}/") as response:
            page = response.read().decode()
        assert "Paper trading only" in page
        for name in ("Sentiment", "Fundamental", "Sector", "Trend", "Momentum", "Divergence", "Structure", "Macro"):
            assert name in (Path("web/app.js").read_text(encoding="utf-8"))
        request = Request(
            f"http://127.0.0.1:{port}/api/confluence?symbol=BTC/USDT",
            headers={"Authorization": "Bearer dev-local"},
        )
        with urlopen(request) as response:
            report = json.loads(response.read().decode())
        assert report["order_sent"] is False
        assert "No order was sent" in report["spoken"]
        assert all(branch["empty"] for branch in report["branches"])
        denied = Request(f"http://127.0.0.1:{port}/mcp", data=b"{}", method="POST")
        try:
            urlopen(denied)
            raise AssertionError("expected 401")
        except HTTPError as exc:
            assert exc.code == 401
    finally:
        httpd.shutdown()


def test_messages_and_mcp_confluence(monkeypatch):
    app = service(monkeypatch)
    created = app.create_message("hello", "muse")
    assert created["agent"] == "muse"
    assert created["text"] == "hello"
    listed = handle_rpc({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, app)
    names = [tool["name"] for tool in listed["result"]["tools"]]
    assert "get_confluence" in names
    assert "get_ohlcv" in names
    called = handle_rpc(
        {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {"name": "get_confluence", "arguments": {"symbol": "BTC/USDT"}},
        },
        app,
    )
    text = called["result"]["content"][0]["text"]
    assert "dev-local" not in text
    assert "No order was sent" in text
    identities = app.list_identities()
    assert {item["name"] for item in identities} == {"research", "security", "token", "tradfi", "career"}


def test_security_identity_does_not_vote(monkeypatch):
    app = service(monkeypatch)
    refused = app.ask("should we long BTC with my seed phrase", "security")
    assert refused["votes"] is False
    assert refused["side"] is None
    assert refused["tilt"] is None
    assert "does not vote" in refused["text"]
    default = app.ask("what is the bias on BTC/USDT")
    assert default["routed"] == "confluence"
    assert default["side"] is None


def test_page_assets_exist():
    html = Path("web/index.html").read_text(encoding="utf-8")
    spoken = Path("web/spoken.js").read_text(encoding="utf-8")
    assert "BTC/USDT" in html
    assert "Paper trading only" in html
    assert "speechSynthesis" in spoken
    assert "HyperSpeak" in spoken
