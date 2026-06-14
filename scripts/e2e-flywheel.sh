#!/usr/bin/env bash
# Phase ④ e2e: the self-improving flywheel.
#   scan (embedding persisted) -> user confirms/corrects (Feedback) ->
#   trainer folds the confirmed embedding into the index (active learning) ->
#   the corrected label is now recognized.
set -euo pipefail
HOST="${PUBLIC_HOST:-127.0.0.1}"
cd "$(dirname "$0")/.."
[ -f .env ] || cp .env.example .env
BASE="http://${HOST}"
DC="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
PSQL() { $DC exec -T db psql -U "${POSTGRES_USER:-tcg}" -d "${POSTGRES_DB:-tcg}" -tAc "$1"; }

echo "==> up + build base index"
$DC up -d --build
cleanup() { $DC down -v; }
trap cleanup EXIT
for i in $(seq 1 90); do curl -fsS "${BASE}/api/health" >/dev/null 2>&1 && { ok=1; break; }; sleep 2; done
[ "${ok:-0}" = 1 ] || { echo "FAIL: web not healthy"; exit 1; }
$DC build trainer
$DC run --rm trainer >/dev/null

echo "==> register + login + scan (embedding persisted on the scan)"
JAR=$(mktemp); E="fw+$(date +%s)@tcg.local"; P="fw-pass-123"
curl -s -o /dev/null -X POST "$BASE/api/register" -H 'Content-Type: application/json' -d "{\"email\":\"$E\",\"password\":\"$P\"}"
CSRF=$(curl -s -c "$JAR" "$BASE/api/auth/csrf" | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/')
curl -s -o /dev/null -b "$JAR" -c "$JAR" -X POST "$BASE/api/auth/callback/credentials" -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "csrfToken=$CSRF" --data-urlencode "email=$E" --data-urlencode "password=$P" --data-urlencode "callbackUrl=$BASE/collection"
SID=$(curl -s -b "$JAR" -X POST "$BASE/api/scan" -F "image=@scripts/fixtures/card.jpg;type=image/jpeg" -F "game=pokemon" | sed -E 's/.*"id":"([^"]+)".*/\1/')
[ -n "$SID" ] || { echo "FAIL: scan no id"; exit 1; }
HAS_EMB=$(PSQL "SELECT (predictions ? 'embedding') FROM \"Scan\" WHERE id='${SID}'")
echo "    scan stored embedding: ${HAS_EMB// /}"
[ "${HAS_EMB// /}" = "t" ] || { echo "FAIL: scan did not persist an embedding"; exit 1; }

LABEL="Flywheel Test Card $(date +%s)"
echo "==> user corrects the scan -> '$LABEL'"
code=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X POST "$BASE/api/feedback" \
  -H 'Content-Type: application/json' -d "{\"scanId\":\"$SID\",\"correctedName\":\"$LABEL\"}")
[ "$code" = "201" ] || { echo "FAIL: feedback returned $code"; exit 1; }

echo "==> retrain: fold the confirmed label into the index (active learning)"
$DC run --rm trainer 2>&1 | grep -E "feedback|incorporated" || true
FBROWS=$(PSQL "SELECT count(*) FROM card_vectors WHERE name='${LABEL}'")
echo "    feedback vectors in index: ${FBROWS// /}"
[ "${FBROWS// /}" -ge 1 ] || { echo "FAIL: confirmed label not added to the index"; exit 1; }

echo "==> the learned label is now recognized (its own embedding -> itself)"
EMB=$(PSQL "SELECT embedding FROM card_vectors WHERE name='${LABEL}' LIMIT 1" | tr -d ' ')
SID2=$(curl -s -b "$JAR" -X POST "$BASE/api/scan" -F "image=@scripts/fixtures/card.jpg;type=image/jpeg" -F "game=pokemon" -F "embedding=$EMB" | sed -E 's/.*"id":"([^"]+)".*/\1/')
GOT=$(PSQL "SELECT predictions->'name'->>'value' FROM \"Scan\" WHERE id='${SID2}'" | sed 's/^ *//;s/ *$//')
echo "    recognized as: '$GOT'"
[ "$GOT" = "$LABEL" ] || { echo "FAIL: learned label not recognized (got '$GOT')"; exit 1; }

rm -f "$JAR"
echo "FLYWHEEL E2E OK"
