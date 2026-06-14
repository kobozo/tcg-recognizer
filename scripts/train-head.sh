#!/usr/bin/env bash
# Sub-project 3: train the DINOv2 projection head, then measure it against the
# zero-shot DINOv2 baseline on the eval harness.
#
#   bash scripts/train-head.sh
#   HEAD_TRAIN_CARDS=3000 EVAL_SUBSET=3000 bash scripts/train-head.sh
#
# The head is written to the shared `models` volume (/models/head.npz), so the
# inference service can use it via EMBED_HEAD=/models/head.npz.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[ -f .env ] || cp .env.example .env

EVAL_SUBSET="${EVAL_SUBSET:-3000}"
EVAL_CARDS="${EVAL_CARDS:-300}"
EVAL_VIEWS="${EVAL_VIEWS:-2}"

echo "==> build trainer (installs CPU torch)"
docker compose build trainer

echo "==> ensure db + mlflow up"
docker compose up -d db mlflow >/dev/null
# Ensure the Prisma tables exist (for the ModelVersion write in the measure
# step). Surface failures rather than hiding them.
docker compose run --rm --no-deps web sh -c "npx prisma db push --skip-generate --accept-data-loss" \
  || echo "WARN: prisma db push failed; the measure step's ModelVersion write may be skipped"

echo "==> train head (precompute DINOv2 features + InfoNCE head)"
docker compose run --rm --no-deps -e EMBEDDER=onnx \
  -e HEAD_TRAIN_CARDS="${HEAD_TRAIN_CARDS:-3000}" \
  -e HEAD_VIEWS="${HEAD_VIEWS:-5}" \
  -e HEAD_EPOCHS="${HEAD_EPOCHS:-40}" \
  trainer python train_head.py

echo "==> measure: DINOv2 + head (+rerank) on the eval harness"
docker compose run --rm \
  -e EMBEDDER=onnx -e EMBED_HEAD=/models/head.npz \
  -e SAMPLE_SIZE="$EVAL_SUBSET" -e EVAL_CARDS="$EVAL_CARDS" -e EVAL_VIEWS="$EVAL_VIEWS" \
  -e RERANK_TOP_K=10 \
  trainer python main.py 2>&1 | grep "\[evaluation\] {" | tail -1

echo
echo "Compare against the SP1/SP2 zero-shot DINOv2 baseline (recall@1 ~0.75, rerank ~0.917)."
echo "Enable in production: set EMBEDDER=onnx and EMBED_HEAD=/models/head.npz."
