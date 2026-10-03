#!/usr/bin/env python3
"""Fetch exact GitHub revisions into a new output directory; no third-party code bundled."""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess


def fetch(lock_path, destination, names=None):
    lock = json.loads(Path(lock_path).read_text())
    if lock.get("schema_version") != 1:
        raise ValueError("Unsupported source lock version")
    selected = names or list(lock["sources"])
    for name in selected:
        item = lock["sources"][name]
        if not re.fullmatch(r"[a-zA-Z0-9_-]+", name):
            raise ValueError("Invalid source name")
        if not re.fullmatch(r"https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\.git", item["url"]):
            raise ValueError("Only explicit GitHub HTTPS repositories are supported")
        if not re.fullmatch(r"[0-9a-f]{40}", item["commit"]):
            raise ValueError("Expected a full immutable commit SHA")
        target = Path(destination) / name
        target.mkdir(parents=True, exist_ok=False)
        def git(*args):
            return subprocess.check_output(["git", "-C", str(target), *args], text=True)
        git("init", "-q")
        git("remote", "add", "origin", item["url"])
        git("fetch", "--depth=1", "origin", item["commit"])
        git("checkout", "--detach", "FETCH_HEAD")
        if git("rev-parse", "HEAD").strip() != item["commit"]:
            raise RuntimeError("Git checkout does not match source lock")
        shutil.rmtree(target / ".git")
        print(f"{name}: {item['commit']}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--lock", default="sources.lock.json")
    parser.add_argument("--dest", default=".sources")
    parser.add_argument("names", nargs="*")
    args = parser.parse_args()
    fetch(args.lock, args.dest, args.names)
