#!/bin/zsh
set -euo pipefail
cd "${0:A:h:h}"
case "${1:-}" in
 --dry-run) print "Would validate local configuration, build, create an owner-only Apps Script project if needed, push, and create/update a versioned deployment."; exit 0 ;;
 "") ;;
 *) print -u2 "Usage: ./scripts/deploy.sh [--dry-run]"; exit 2 ;;
esac
mkdir -p local
npm run build
node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync("build/.build-info.json"));if(!b.configured)throw Error("Set DAYOFF_CONFIG in .env before deployment");'
if [[ ! -f .clasp.json ]]; then
 npx --no-install clasp create-script --type standalone --title Dayoff --rootDir build
 npm run build
fi
npx --no-install clasp push --force
deployment_id="${DAYOFF_DEPLOYMENT_ID:-}"
if [[ -z "$deployment_id" && -f local/deployment.json ]]; then
 deployment_id="$(node -p 'JSON.parse(require("fs").readFileSync("local/deployment.json")).deploymentId')"
fi
if [[ -n "$deployment_id" ]]; then
 npx --no-install clasp --json create-deployment --deploymentId "$deployment_id" --description "Dayoff $(git rev-parse --short HEAD)" > local/deployment.next.json
else
 npx --no-install clasp --json create-deployment --description "Dayoff initial owner-only trial" > local/deployment.next.json
fi
mv local/deployment.next.json local/deployment.json
npx --no-install tsx scripts/resolve-deployment.ts
print "Google may require first-use OAuth consent."
