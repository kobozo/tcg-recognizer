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
# Default routes through the Caddy proxy (the only published port); the web
# container's own 3000 isn't exposed on the host. 127.0.0.1 (not localhost) to
# avoid IPv6 ::1, which Docker's published port doesn't bind.
url="${CATALOG_SYNC_URL:-http://127.0.0.1/api/catalog/sync}"

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
