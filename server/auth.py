"""Sandbox auth for MCP and HTTP. The owner key is not accepted here."""

from __future__ import annotations

import hmac
import os


def expected_key() -> str:
    return os.environ.get("MCP_API_KEY", "").strip()


def extract_key(headers: dict[str, str], query_key: str | None = None) -> str | None:
    lowered = {name.lower(): value for name, value in headers.items()}
    # x-owner-key is never a substitute for the sandbox key.
    auth = lowered.get("authorization", "")
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip()
        return token or None
    header_key = lowered.get("x-api-key")
    if header_key and header_key.strip():
        return header_key.strip()
    if query_key and query_key.strip():
        return query_key.strip()
    return None


def key_ok(got: str | None) -> bool:
    expected = expected_key()
    if not expected or not got or len(got) != len(expected):
        return False
    return hmac.compare_digest(got, expected)


def auth_configured() -> bool:
    return bool(expected_key())
