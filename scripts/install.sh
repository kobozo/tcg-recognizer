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
MARKER="# tcg-recognizer-retrain"

remove_cron() {
  crontab -l 2>/dev/null | grep -v "scripts/retrain.sh" | grep -v "tcg-recognizer-retrain" | crontab - 2>/dev/null || true
}

if [ "${1:-}" = "--uninstall" ]; then
  remove_cron
  echo "Removed the tcg-recognizer retrain cron."
  exit 0
fi

# 1. env file
[ -f .env ] || { cp .env.example .env; echo "==> created .env from .env.example"; }

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

# 6. install / refresh the cron (idempotent)
echo "==> installing retrain cron: ${SCHEDULE}"
remove_cron
(
  crontab -l 2>/dev/null || true
  echo "${MARKER} (auto-retrain; remove with: bash ${ROOT}/scripts/install.sh --uninstall)"
  echo "${SCHEDULE} cd ${ROOT} && /usr/bin/env bash scripts/retrain.sh"
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
