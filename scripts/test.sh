#!/bin/zsh
set -euo pipefail
cd "${0:A:h:h}"
docker-compose run --build --rm tests
docker-compose run --build --rm importer-tests
