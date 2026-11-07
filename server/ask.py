"""Route ask() by keyword. The security identity is a gate, not a vote."""

from __future__ import annotations

from pathlib import Path

IDENTITIES = ("research", "security", "token", "tradfi", "career")

# Security is checked first. Unmatched text falls through to confluence.
KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("security", ("security", "scam", "seed phrase", "private key", "recovery phrase", "qfs")),
    ("research", ("research", "osint", "primary source", "filing")),
    ("token", ("tokenomics", "token", "vesting", "unlock")),
    ("tradfi", ("tradfi", "rwa", "institutional liquidity")),
    ("career", ("career", "labor market", "hiring", "job market")),
)

GATE_MARKERS = (
    "seed phrase",
    "private key",
    "secret key",
    "recovery phrase",
    "mnemonic",
    "qfs",
    "quantum financial",
)


def route_identity(text: str, identity: str | None = None) -> str | None:
    if identity:
        cleaned = identity.strip().lower()
        return cleaned if cleaned in IDENTITIES else None
    lowered = text.lower()
    for name, words in KEYWORDS:
        if any(word in lowered for word in words):
            return name
    return None


def security_tripped(text: str) -> bool:
    lowered = text.lower()
    return any(marker in lowered for marker in GATE_MARKERS)


def load_prompt(root: Path, identity: str) -> str:
    path = root / "identities" / identity / "AGENT.md"
    if not path.is_file():
        return ""
    return path.read_text(encoding="utf-8")


def list_identities(root: Path) -> list[dict[str, str]]:
    found = []
    for name in IDENTITIES:
        path = root / "identities" / name / "AGENT.md"
        if path.is_file():
            found.append({"name": name, "path": f"identities/{name}/AGENT.md"})
    return found


def ask(text: str, identity: str | None, root: Path) -> dict[str, object]:
    tripped = security_tripped(text)
    chosen = route_identity(text, identity)
    if tripped or chosen == "security":
        return {
            "identity": "security",
            "votes": False,
            "tilt": None,
            "side": None,
            "gated": True,
            "routed": "security",
            "text": (
                "Security is a gate and does not vote long or short. "
                "No seed, key, or QFS step will be taken."
            ),
            "prompt_loaded": bool(load_prompt(root, "security")),
            "order_sent": False,
        }
    if chosen is None:
        return {
            "identity": None,
            "votes": False,
            "tilt": None,
            "side": None,
            "gated": False,
            "routed": "confluence",
            "text": "No identity named. Use get_confluence. Paper only. No order was sent.",
            "prompt_loaded": False,
            "order_sent": False,
        }
    prompt = load_prompt(root, chosen)
    return {
        "identity": chosen,
        "votes": False,
        "tilt": None,
        "side": None,
        "gated": False,
        "routed": chosen,
        "text": prompt or f"identities/{chosen}/AGENT.md is missing",
        "prompt_loaded": bool(prompt),
        "order_sent": False,
    }
