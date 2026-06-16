#!/usr/bin/env bash
# One-shot installer: start the TCG Recognizer stack and install a cron that
# retrains the recognition model on a schedule.
#
#   bash scripts/install.sh              # start + initial retrain + install cron (nightly 03:00)
#   CRON_SCHEDULE="0 */6 * * *" bash scripts/install.sh   # custom cadence (every 6h)
#   bash scripts/install.sh --uninstall  # remove the retrain cron
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SCHEDULE="${CRON_SCHEDULE:-0 3 * * *}"
# Daily price refresh, offset from the retrain so they don't overlap.
CATALOG_SCHEDULE="${CATALOG_CRON_SCHEDULE:-30 3 * * *}"
MARKER="# tcg-recognizer-retrain"
CATALOG_MARKER="# tcg-recognizer-catalog"

remove_cron() {
  crontab -l 2>/dev/null \
    | grep -v "scripts/retrain.sh" | grep -v "tcg-recognizer-retrain" \
    | grep -v "scripts/catalog-sync.sh" | grep -v "tcg-recognizer-catalog" \
    | crontab - 2>/dev/null || true
}

if [ "${1:-}" = "--uninstall" ]; then
  remove_cron
  echo "Removed the tcg-recognizer retrain cron."
  exit 0
fi

# 1. env file
[ -f .env ] || { cp .env.example .env; echo "==> created .env from .env.example"; }

# 1b. ensure a catalogue-sync secret exists (the daily price cron presents it)
if ! grep -qE '^CATALOG_SYNC_SECRET=.+' .env; then
  gen="$(openssl rand -base64 32 2>/dev/null | tr -d '/+=' | head -c 40)"
  if grep -qE '^CATALOG_SYNC_SECRET=' .env; then
    sed -i "s|^CATALOG_SYNC_SECRET=.*|CATALOG_SYNC_SECRET=${gen}|" .env
  else
    echo "CATALOG_SYNC_SECRET=${gen}" >> .env
  fi
  echo "==> generated CATALOG_SYNC_SECRET"
fi

# 2. start the stack
echo "==> starting stack (docker compose up -d --build)"
docker compose up -d --build

# 3. wait for the web app to be healthy
echo "==> waiting for the app to be healthy"
ok=0
for _ in $(seq 1 120); do
  if curl -fsS http://127.0.0.1/api/health >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
[ "$ok" = 1 ] || { echo "WARN: app did not report healthy in time; check 'docker compose logs web'"; }

# 4. seed the admin account (idempotent)
docker compose exec -T web node_modules/.bin/tsx prisma/seed.ts >/dev/null 2>&1 \
  && echo "==> admin account seeded" || true

# 5. initial retrain so there is a baseline ModelVersion + a populated index
echo "==> initial retrain (builds the recognition index; downloads card images)"
docker compose run --rm trainer || echo "WARN: initial retrain failed; see output above"

# 5b. initial full catalogue sync so reads serve from the local mirror, not the API
echo "==> initial catalogue sync (mirrors all cards + sets into the DB)"
/usr/bin/env bash scripts/catalog-sync.sh full pokemon \
  && echo "==> catalogue synced (see logs/catalog-sync.log)" \
  || echo "WARN: initial catalogue sync failed; see logs/catalog-sync.log"

# 6. install / refresh the cron (idempotent)
echo "==> installing retrain cron: ${SCHEDULE}; catalogue price cron: ${CATALOG_SCHEDULE}"
remove_cron
(
  crontab -l 2>/dev/null || true
  echo "${MARKER} (auto-retrain; remove with: bash ${ROOT}/scripts/install.sh --uninstall)"
  echo "${SCHEDULE} cd ${ROOT} && /usr/bin/env bash scripts/retrain.sh"
  echo "${CATALOG_MARKER} (daily price refresh; remove with: bash ${ROOT}/scripts/install.sh --uninstall)"
  echo "${CATALOG_SCHEDULE} cd ${ROOT} && /usr/bin/env bash scripts/catalog-sync.sh prices pokemon"
) | crontab -

echo
echo "==> cron installed:"
crontab -l | grep -A1 "tcg-recognizer-retrain" || true
echo
echo "Done."
echo "  App:    http://192.168.3.177"
echo "  MLflow: http://192.168.3.177:5000   (admin -> MLOps shows every retrain)"
echo "  Retrains so far = ModelVersion rows. Cadence: ${SCHEDULE}"
echo "  Change cadence: CRON_SCHEDULE='0 */6 * * *' bash scripts/install.sh"
echo "  Remove cron:    bash scripts/install.sh --uninstall"
echo "  Retrain logs:   ${ROOT}/logs/retrain.log"
echo "  Catalogue:      mirrored to Postgres; daily price refresh at ${CATALOG_SCHEDULE}"
echo "  Catalog logs:   ${ROOT}/logs/catalog-sync.log"
echo "  Re-sync now:    bash scripts/catalog-sync.sh full pokemon"
