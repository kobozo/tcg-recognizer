#!/usr/bin/env bash
# `train` stage command for dvc.yaml (sub-project 4).
#
# Reads params.yaml's `train.*` knobs and runs the existing dockerised trainer
# with the matching UPPER_SNAKE env overrides (SAMPLE_SIZE, EVAL_CARDS, ... —
# already understood by services/trainer/src/main.py:load_cfg()). The trainer
# writes the DVC metric to ml/metrics.json via the /mlout mount.
#
# Invoked by `dvc repro`, but also runnable directly:
#   bash scripts/dvc-train.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[ -f .env ] || cp .env.example .env
mkdir -p ml

# --- read params.yaml (train.*) ---
# Prefer host python (has pyyaml here); fall back to the trainer container.
read_params() {
  if python3 -c "import yaml" >/dev/null 2>&1; then
    python3 - "$@" <<'PY'
import sys, yaml
p = yaml.safe_load(open("params.yaml"))["train"]
keys = ["game","sample_size","embedder","embed_dim","eval_cards","eval_views","eval_seed","rerank_top_k"]
print("\n".join(f"{k}={p[k]}" for k in keys))
PY
  else
    docker compose run --rm --no-deps -v "$ROOT:/repo" -w /repo \
      --entrypoint python trainer - <<'PY'
import yaml
p = yaml.safe_load(open("params.yaml"))["train"]
keys = ["game","sample_size","embedder","embed_dim","eval_cards","eval_views","eval_seed","rerank_top_k"]
print("\n".join(f"{k}={p[k]}" for k in keys))
PY
  fi
}

# shellcheck disable=SC2046
while IFS='=' read -r k v; do
  case "$k" in
    game) GAME="$v" ;;
    sample_size) SAMPLE_SIZE="$v" ;;
    embedder) EMBEDDER="$v" ;;
    embed_dim) EMBED_DIM="$v" ;;
    eval_cards) EVAL_CARDS="$v" ;;
    eval_views) EVAL_VIEWS="$v" ;;
    eval_seed) EVAL_SEED="$v" ;;
    rerank_top_k) RERANK_TOP_K="$v" ;;
  esac
done < <(read_params)

echo "==> dvc train: game=$GAME embedder=$EMBEDDER sample_size=$SAMPLE_SIZE eval=${EVAL_CARDS}x${EVAL_VIEWS} rerank=$RERANK_TOP_K"

echo "==> ensure db + mlflow up"
docker compose up -d db mlflow >/dev/null
docker compose run --rm --no-deps web sh -c \
  "npx prisma db push --skip-generate --accept-data-loss" >/dev/null 2>&1 || true

echo "==> build trainer"
docker compose build trainer >/dev/null

echo "==> run trainer (writes ml/metrics.json via /mlout mount)"
# Run as the host user so the metric file (./ml/metrics.json) is owned by us,
# not root — otherwise host-side dvc can't manage it. The /models artifact write
# is best-effort and skips gracefully if the named volume isn't writable as us.
docker compose run --rm \
  --user "$(id -u):$(id -g)" \
  -e EMBEDDER="$EMBEDDER" \
  -e SAMPLE_SIZE="$SAMPLE_SIZE" \
  -e EMBED_DIM="$EMBED_DIM" \
  -e EVAL_CARDS="$EVAL_CARDS" \
  -e EVAL_VIEWS="$EVAL_VIEWS" \
  -e EVAL_SEED="$EVAL_SEED" \
  -e RERANK_TOP_K="$RERANK_TOP_K" \
  -e METRICS_PATH=/mlout/metrics.json \
  trainer python main.py

echo "==> done. metric: ml/metrics.json"
