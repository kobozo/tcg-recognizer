#!/usr/bin/env bash
# Trigger a catalogue sync against the running web service.
#   scripts/catalog-sync.sh [prices|full] [game]
# Defaults: mode=prices, game=pokemon.
#
# The static catalogue (cards + sets) is mirrored once with `full`; thereafter a
# daily `prices` run refreshes only the market data. Invoked manually for the
# initial full sync, and by the cron installed by scripts/install.sh for prices.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

mode="${1:-prices}"
game="${2:-pokemon}"

# Read CATALOG_SYNC_SECRET from .env (the secret the route expects from cron).
secret=""
if [ -f .env ]; then
  secret="$(grep -E '^CATALOG_SYNC_SECRET=' .env | head -n1 | cut -d= -f2-)"
fi
url="${CATALOG_SYNC_URL:-http://localhost:3000/api/catalog/sync}"

mkdir -p logs
ts="$(date -u +%FT%TZ 2>/dev/null || date -u)"
{
  echo "[$ts] catalog-sync start (mode=$mode game=$game)"
  curl -fsS -X POST "$url" \
    -H "Authorization: Bearer ${secret}" \
    -H "Content-Type: application/json" \
    --max-time 3600 \
    -d "{\"mode\":\"${mode}\",\"game\":\"${game}\"}"
  rc=$?
  echo
  if [ "$rc" = 0 ]; then
    echo "[$ts] catalog-sync OK"
  else
    echo "[$ts] catalog-sync FAILED (exit $rc)"
  fi
} >> logs/catalog-sync.log 2>&1
