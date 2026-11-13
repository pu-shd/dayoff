#!/bin/zsh
set -euo pipefail
cd "${0:A:h:h}"
mkdir -p local
[[ -f .env ]] || cp example.env .env
[[ -f local/config.json ]] || cp config/example.json local/config.json
uv sync --locked
npm ci
print "Edit local/config.json, then import a workbook with .venv/bin/python scripts/import_workbook.py."
