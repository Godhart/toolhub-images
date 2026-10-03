from pathlib import Path
import pytest

@pytest.fixture
def make_project(tmp_path):
    def make(files):
        root = tmp_path / "rtl"
        for name, content in files.items():
            p = root / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(content, encoding="utf-8")
        return root
    return make
