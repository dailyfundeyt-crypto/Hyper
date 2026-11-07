from pathlib import Path

from scripts.check_secrets import scan


def test_scanner_flags_a_key_file(tmp_path):
    (tmp_path / ".pc-key").write_text("not-a-real-key", encoding="utf-8")
    problems = scan(tmp_path)
    assert any(".pc-key" in item for item in problems)


def test_scanner_accepts_the_repo_examples():
    problems = scan(Path(".").resolve())
    assert problems == []
