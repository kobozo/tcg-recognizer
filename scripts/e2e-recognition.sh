#!/usr/bin/env bash
# Phase ② e2e: build the pgvector index with the trainer, then prove a scan goes
# through the real embedding/nearest-neighbour path (model_version "embed-v1"),
# not the stub. Heavier than smoke.sh (downloads card images) — run locally.
set -euo pipefail
HOST="${PUBLIC_HOST:-127.0.0.1}"
cd "$(dirname "$0")/.."
[ -f .env ] || cp .env.example .env
BASE="http://${HOST}"
DC="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

echo "==> up (pgvector db + inference + mlflow + web)"
$DC up -d --build
cleanup() { $DC down -v; }
trap cleanup EXIT

for i in $(seq 1 90); do curl -fsS "${BASE}/api/health" >/dev/null 2>&1 && { ok=1; break; }; sleep 2; done
[ "${ok:-0}" = 1 ] || { echo "FAIL: web never healthy"; $DC logs --tail=60; exit 1; }

echo "==> build the recognition index (trainer → pgvector)"
$DC build trainer
$DC run --rm trainer

echo "==> card_vectors rows"
ROWS=$($DC exec -T db psql -U "${POSTGRES_USER:-tcg}" -d "${POSTGRES_DB:-tcg}" -tAc "SELECT count(*) FROM card_vectors;")
echo "    card_vectors = ${ROWS// /}"
[ "${ROWS// /}" -ge 1 ] || { echo "FAIL: index empty"; exit 1; }

echo "==> register + login + scan"
JAR=$(mktemp)
E="rec+$(date +%s)@tcg.local"; P="rec-pass-123"
curl -s -o /dev/null -X POST "$BASE/api/register" -H 'Content-Type: application/json' -d "{\"email\":\"$E\",\"password\":\"$P\"}"
CSRF=$(curl -s -c "$JAR" "$BASE/api/auth/csrf" | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/')
curl -s -o /dev/null -b "$JAR" -c "$JAR" -X POST "$BASE/api/auth/callback/credentials" -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "csrfToken=$CSRF" --data-urlencode "email=$E" --data-urlencode "password=$P" --data-urlencode "callbackUrl=$BASE/collection"
SID=$(curl -s -b "$JAR" -X POST "$BASE/api/scan" -F "image=@scripts/fixtures/card.jpg;type=image/jpeg" -F "game=pokemon" | sed -E 's/.*"id":"([^"]+)".*/\1/')
[ -n "$SID" ] || { echo "FAIL: scan returned no id"; exit 1; }

echo "==> the scan used the real model (embed-v1), not the stub"
MV=$($DC exec -T db psql -U "${POSTGRES_USER:-tcg}" -d "${POSTGRES_DB:-tcg}" -tAc "SELECT \"modelVersion\" FROM \"Scan\" WHERE id='${SID}';")
echo "    modelVersion = ${MV// /}"
case "${MV// /}" in
  embed-v1*) echo "    real recognition path confirmed" ;;
  *) echo "FAIL: scan used '${MV// /}', expected embed-v1* (real pgvector path)"; exit 1 ;;
esac

echo "==> a ModelVersion row was registered for the admin MLOps view"
$DC exec -T db psql -U "${POSTGRES_USER:-tcg}" -d "${POSTGRES_DB:-tcg}" -tAc \
  "SELECT version FROM \"ModelVersion\" WHERE version LIKE 'embed-v1%' AND \"isCurrent\"=true;" | grep -q embed-v1 \
  || { echo "FAIL: no current embed-v1 ModelVersion"; exit 1; }

echo "==> on-device path: a precomputed embedding resolves to the exact card"
CARD=$($DC exec -T db psql -U "${POSTGRES_USER:-tcg}" -d "${POSTGRES_DB:-tcg}" -tAc \
  "SELECT name FROM card_vectors WHERE game='pokemon' ORDER BY card_id LIMIT 1" | sed 's/^ *//;s/ *$//')
EMB=$($DC exec -T db psql -U "${POSTGRES_USER:-tcg}" -d "${POSTGRES_DB:-tcg}" -tAc \
  "SELECT embedding FROM card_vectors WHERE game='pokemon' ORDER BY card_id LIMIT 1" | tr -d ' ')
SID2=$(curl -s -b "$JAR" -X POST "$BASE/api/scan" \
  -F "image=@scripts/fixtures/card.jpg;type=image/jpeg" -F "game=pokemon" -F "embedding=$EMB" \
  | sed -E 's/.*"id":"([^"]+)".*/\1/')
[ -n "$SID2" ] || { echo "FAIL: on-device scan returned no id"; exit 1; }
GOT=$($DC exec -T db psql -U "${POSTGRES_USER:-tcg}" -d "${POSTGRES_DB:-tcg}" -tAc \
  "SELECT predictions->'name'->>'value' FROM \"Scan\" WHERE id='${SID2}'" | sed 's/^ *//;s/ *$//')
echo "    expected '${CARD}' got '${GOT}'"
[ -n "$CARD" ] && [ "$GOT" = "$CARD" ] || { echo "FAIL: on-device precomputed embedding did not match the source card"; exit 1; }
echo "    on-device precomputed-embedding recognition confirmed"

rm -f "$JAR"
echo "RECOGNITION E2E OK"
