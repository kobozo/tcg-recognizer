#!/usr/bin/env bash
set -euo pipefail
# Default to 127.0.0.1 (not "localhost") — Docker publishes ports on IPv4 and
# "localhost" can resolve to ::1 first, giving a false connection-refused.
HOST="${PUBLIC_HOST:-127.0.0.1}"
cd "$(dirname "$0")/.."
[ -f .env ] || cp .env.example .env
echo "==> building + starting stack"
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
cleanup() { docker compose -f docker-compose.yml -f docker-compose.prod.yml down -v; }
trap cleanup EXIT

echo "==> waiting for web health via proxy"
for i in $(seq 1 60); do
  if curl -fsS "http://${HOST}/api/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
[ "${ok:-0}" = "1" ] || { echo "FAIL: web health never came up"; docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --tail=50; exit 1; }

echo "==> checking inference stub directly"
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T inference python -c "import urllib.request,json; print(urllib.request.urlopen('http://localhost:8001/health').read().decode())"

echo "SMOKE OK"
