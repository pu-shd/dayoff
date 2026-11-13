#!/bin/zsh
set -euo pipefail
cd "${0:A:h:h}"
node scripts/dispatch.mjs source
docker-compose run --build --rm instance-checks
docker-compose run --build --rm source-checks
./local/app/scripts/test.sh
