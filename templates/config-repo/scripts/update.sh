#!/bin/zsh
set -euo pipefail
cd "${0:A:h:h}"
exec node scripts/dispatch.mjs update "$@"
