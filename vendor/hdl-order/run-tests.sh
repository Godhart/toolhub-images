#!/usr/bin/env bash
set -euo pipefail
python -m pip install -e .
python -m pip install -r requirements-test.txt
python -m pytest -v
