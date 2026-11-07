import json

from server.service import HyperService
from server.zapier_proxy import ZapierProxy


def test_zapier_token_never_appears_in_lists_or_results(monkeypatch):
    secret = "zapier-token-should-stay-server-side"
    monkeypatch.setenv("ZAPIER_MCP_TOKEN", secret)
    monkeypatch.setenv("ZAPIER_MCP_URL", "https://example.test/mcp")
    monkeypatch.setenv("MCP_API_KEY", "dev-local")
    proxy = ZapierProxy(
        clock=lambda: 0,
        fetch_tools=lambda: [{"name": "find_email", "description": f"leak {secret}"}],
        call_tool=lambda name, args: {"echo": secret, "name": name},
    )
    listed = json.dumps(proxy.list_tools())
    assert secret not in listed
    assert "zapier_find_email" in listed
    again = proxy.list_tools()
    assert again[0]["name"] == "zapier_find_email"
    read = json.dumps(proxy.call("zapier_find_email", {}, approvals=None))
    assert secret not in read
    blocked = proxy.call(
        "zapier_create_folder",
        {"dry_run": True, "title": "notes"},
        approvals=None,
    )
    assert blocked["allowed"] is False
    assert blocked["executed"] is False
    assert blocked["order_sent"] is False
    assert secret not in json.dumps(blocked)


def test_mcp_tool_list_redacts_the_token(monkeypatch, tmp_path):
    secret = "zapier-token-should-stay-server-side"
    monkeypatch.setenv("ZAPIER_MCP_TOKEN", secret)
    monkeypatch.setenv("ZAPIER_MCP_URL", "https://example.test/mcp")
    monkeypatch.setenv("MCP_API_KEY", "dev-local")
    app = HyperService(root=tmp_path)
    app.zapier = ZapierProxy(
        clock=lambda: 0,
        fetch_tools=lambda: [{"name": "send_chat", "description": secret}],
        call_tool=lambda name, args: {"hidden": secret},
    )
    blob = json.dumps(app.tool_specs())
    assert secret not in blob
    assert "zapier_send_chat" in blob
    pending = app.request_approval("msg-1", "purchase", "do not buy")
    assert pending["status"] == "pending"
    assert pending["order_sent"] is False
    result = app.call_tool(
        "zapier_send_chat",
        {"message_id": "msg-1", "approval_id": pending["id"], "dry_run": True, "text": "hi"},
    )
    assert result["executed"] is False
    assert secret not in json.dumps(result)
