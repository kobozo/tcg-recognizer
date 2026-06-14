#!/usr/bin/env bash
set -euo pipefail
# Default to 127.0.0.1 (not "localhost") — Docker publishes ports on IPv4 and
# "localhost" can resolve to ::1 first, giving a false connection-refused.
HOST="${PUBLIC_HOST:-127.0.0.1}"
cd "$(dirname "$0")/.."
[ -f .env ] || cp .env.example .env
BASE="http://${HOST}"
DC="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

echo "==> building + starting stack"
$DC up -d --build
cleanup() { $DC down -v; }
trap cleanup EXIT

echo "==> waiting for web health via proxy"
for i in $(seq 1 60); do
  if curl -fsS "${BASE}/api/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
[ "${ok:-0}" = "1" ] || { echo "FAIL: web health never came up"; $DC logs --tail=80; exit 1; }

echo "==> checking inference stub directly"
$DC exec -T inference python -c "import urllib.request; print(urllib.request.urlopen('http://localhost:8001/health').read().decode())"

# --- e2e: register -> login (NextAuth credentials) -> scan -> result ---
JAR="$(mktemp)"
EMAIL="smoke+$(date +%s)@tcg.local"
PASS="smoke-pass-123"
trap '$DC down -v; rm -f "$JAR"' EXIT

echo "==> register ${EMAIL}"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/register" \
  -H 'Content-Type: application/json' -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASS}\"}")
[ "$code" = "201" ] || { echo "FAIL: register returned $code"; $DC logs web --tail=60; exit 1; }

echo "==> fetch CSRF token"
CSRF=$(curl -s -c "$JAR" "${BASE}/api/auth/csrf" | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/')
[ -n "$CSRF" ] || { echo "FAIL: no csrf token"; exit 1; }

echo "==> sign in (credentials callback)"
curl -s -o /dev/null -b "$JAR" -c "$JAR" -X POST \
  "${BASE}/api/auth/callback/credentials" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "csrfToken=${CSRF}" \
  --data-urlencode "email=${EMAIL}" \
  --data-urlencode "password=${PASS}" \
  --data-urlencode "callbackUrl=${BASE}/scan"
grep -q 'authjs.session-token' "$JAR" || { echo "FAIL: no session cookie after sign-in"; cat "$JAR"; $DC logs web --tail=60; exit 1; }

echo "==> add a Pokémon card to /api/scan"
SCAN_JSON=$(curl -s -b "$JAR" -X POST "${BASE}/api/scan" \
  -F "image=@scripts/fixtures/card.jpg;type=image/jpeg" -F "game=pokemon")
SCAN_ID=$(echo "$SCAN_JSON" | sed -E 's/.*"id":"([^"]+)".*/\1/')
[ -n "$SCAN_ID" ] && [ "$SCAN_ID" != "$SCAN_JSON" ] || { echo "FAIL: scan returned: $SCAN_JSON"; $DC logs web --tail=60; exit 1; }
echo "    scan id = ${SCAN_ID}"

echo "==> add a Magic card to /api/scan (multi-TCG)"
MAGIC_JSON=$(curl -s -b "$JAR" -X POST "${BASE}/api/scan" \
  -F "image=@scripts/fixtures/card.jpg;type=image/jpeg" -F "game=magic")
echo "$MAGIC_JSON" | grep -q '"id"' || { echo "FAIL: magic scan returned: $MAGIC_JSON"; exit 1; }

echo "==> fetch result page /scan/${SCAN_ID}"
code=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "${BASE}/scan/${SCAN_ID}")
[ "$code" = "200" ] || { echo "FAIL: result page returned $code"; exit 1; }

echo "==> fetch /collection (My collection)"
code=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "${BASE}/collection")
[ "$code" = "200" ] || { echo "FAIL: /collection returned $code"; exit 1; }

echo "==> fetch /sets hub + per-game sets (multi-TCG)"
for p in /sets /sets/pokemon /sets/magic; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "${BASE}${p}")
  [ "$code" = "200" ] || { echo "FAIL: ${p} returned $code"; exit 1; }
done

echo "==> signed-in / should redirect to /collection (collection-first)"
loc=$(curl -s -o /dev/null -w '%{redirect_url}' -b "$JAR" "${BASE}/")
case "$loc" in
  */collection) echo "    / -> $loc" ;;
  *) echo "FAIL: signed-in / did not redirect to /collection (got '$loc')"; exit 1 ;;
esac

echo "==> seed admin + verify admin user exists"
# The standalone image has no npm scripts / prisma-seed config, so run tsx directly.
$DC exec -T -e ADMIN_EMAIL="${ADMIN_EMAIL:-admin@tcg.local}" -e ADMIN_PASSWORD="${ADMIN_PASSWORD:-change-me-admin}" \
  web node_modules/.bin/tsx prisma/seed.ts >/dev/null
ADMIN_COUNT=$($DC exec -T db psql -U "${POSTGRES_USER:-tcg}" -d "${POSTGRES_DB:-tcg}" -tAc "SELECT count(*) FROM \"User\" WHERE role='ADMIN'")
[ "${ADMIN_COUNT// /}" -ge 1 ] || { echo "FAIL: admin seed did not create an admin (count=$ADMIN_COUNT)"; exit 1; }

echo "E2E OK (register -> login -> scan pokemon+magic -> result -> collection -> sets hub/pokemon/magic -> admin)"
echo "SMOKE OK"
