#!/bin/zsh
set -euo pipefail
cd "${0:A:h:h}"
configure_args=()
dry_run=false
for arg in "$@"; do
 case "$arg" in
  --dry-run) dry_run=true ;;
  --help) print "Usage: ./scripts/bootstrap-local.sh [--calendar-id ID] [--management-email ADDRESS ...] [--fiscal-year-start MM-DD] [--dry-run]"; exit 0 ;;
  *) configure_args+=("$arg") ;;
 esac
done
# Validate CLI input before creating files or installing dependencies.
if (( ${#configure_args[@]} > 0 )); then
 node scripts/configure.ts "${configure_args[@]}" --dry-run
fi
if [[ "$dry_run" == true ]]; then
 print "Would retain/create private local configuration, sync the project Python environment, install locked Node dependencies, and apply supplied connection settings."
 exit 0
fi
mkdir -p local
[[ -f .env ]] || cp example.env .env
[[ -f local/config.json ]] || cp config/example.json local/config.json
chmod 600 .env local/config.json
uv sync --locked
npm ci
if (( ${#configure_args[@]} > 0 )); then
 node scripts/configure.ts "${configure_args[@]}"
fi
print "Private setup ready. Configure reporting recipients and schedules, then import a workbook if needed."
