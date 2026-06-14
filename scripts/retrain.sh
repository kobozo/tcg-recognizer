#!/usr/bin/env bash
# Run one retrain of the recognition model against the running stack.
# Invoked manually or by the cron installed by scripts/install.sh.
# Each successful run writes a ModelVersion row (the retrain count) and folds
# any confirmed feedback into the index (active learning).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p logs
ts="$(date -u +%FT%T%TZ 2>/dev/null || date -u)"
{
  echo "[$ts] retrain start"
  if docker compose run --rm trainer; then
    echo "[$ts] retrain OK"
  else
    echo "[$ts] retrain FAILED (exit $?)"
  fi
} >> logs/retrain.log 2>&1
