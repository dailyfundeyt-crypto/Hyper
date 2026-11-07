import pytest


@pytest.fixture(autouse=True)
def spoken_file(tmp_path, monkeypatch):
    monkeypatch.setenv("HYPER_SPOKEN_FILE", str(tmp_path / "spoken.md"))
