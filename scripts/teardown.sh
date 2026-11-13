#!/bin/zsh
set -euo pipefail
cd "${0:A:h:h}"
if [[ "${1:-}" == "--dry-run" ]]; then
 print "Would push disabled-delivery source so reminder triggers become inert, remove the selected web deployment, and retain the private ledger."
 exit 0
fi
[[ $# == 1 ]] || { print -u2 "Usage: ./scripts/teardown.sh DEPLOYMENT_ID | --dry-run"; exit 2; }
node scripts/disable-delivery.mjs
DAYOFF_CONFIG=local/teardown-config.json npm run build
npx --no-install clasp push --force
npx --no-install clasp delete-deployment "$1"
print "Delivery disabled and web deployment removed. Private ledger retained. Existing time-driven triggers are inert; remove them through the app before teardown if desired."
