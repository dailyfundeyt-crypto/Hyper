#!/usr/bin/env python3
"""Fail when a secret-looking file is present in the tree."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

FORBIDDEN_NAMES = {
    ".env",
    ".env.local",
    ".env.production",
    ".pc-key",
    ".owner-key",
    ".flag-url",
    ".key",
    ".agent-key",
}

FORBIDDEN_SUFFIXES = {".pem", ".p12"}


def _marker(kind: str) -> str:
    return "BEGIN " + kind


PRIVATE_MARKERS = (
    _marker("PRIVATE KEY"),
    _marker("RSA PRIVATE KEY"),
    _marker("OPENSSH PRIVATE KEY"),
    _marker("PGP PRIVATE KEY"),
)

SKIP_PARTS = {".git", ".venv", "venv", "node_modules", "__pycache__", ".pytest_cache"}

ALLOWED_ENV_VALUES = {"", "replace-me", "your-anon-key", "changeme", "binance"}
ALLOWED_ENV_KEYS = {"NEXT_PUBLIC_BASE_URL", "EXCHANGE_ID"}


def scan(root: Path) -> list[str]:
    problems: list[str] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if any(part in SKIP_PARTS for part in path.parts):
            continue
        name = path.name
        rel = path.relative_to(root)
        if name in FORBIDDEN_NAMES or path.suffix in FORBIDDEN_SUFFIXES:
            problems.append(f"forbidden file: {rel}")
            continue
        if name.startswith(".agent-key"):
            problems.append(f"forbidden file: {rel}")
            continue
        if name.startswith(".env") and name not in {".env.example", ".env.local.example"}:
            problems.append(f"env file: {rel}")
            continue
        if path.stat().st_size > 1_000_000:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for marker in PRIVATE_MARKERS:
            if marker in text:
                problems.append(f"{marker} in {rel}")
        if name.startswith(".env"):
            problems.extend(_check_env_example(rel, text))
    return problems


def _check_env_example(rel: Path, text: str) -> list[str]:
    problems: list[str] = []
    for lineno, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if not value or value in ALLOWED_ENV_VALUES or key in ALLOWED_ENV_KEYS:
            continue
        if "YOUR_" in value or "example.com" in value:
            continue
        problems.append(f"env value in {rel}:{lineno} ({key})")
    return problems


def main() -> int:
    problems = scan(ROOT)
    if problems:
        print("\n".join(problems))
        return 1
    print("secret check ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
