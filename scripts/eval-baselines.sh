#!/usr/bin/env bash
# Sub-project 1 test: build the index + run the realistic synthetic-photo eval
# harness for each embedder, and print a recall@1/@5/@10 comparison.
#
#   bash scripts/eval-baselines.sh                  # subset baseline (fast, CPU)
#   SUBSET=all EVAL_CARDS=500 bash scripts/eval-baselines.sh   # full 20k
#
# Each run rebuilds card_vectors with the given embedder (the index vectors must
# match the query embedder), then evaluates against held-out synthetic photos.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[ -f .env ] || cp .env.example .env

SUBSET="${SUBSET:-3000}"        # cards to index per run ("all" or an int)
EVAL_CARDS="${EVAL_CARDS:-300}"
EVAL_VIEWS="${EVAL_VIEWS:-2}"
EMBEDDERS="${EMBEDDERS:-classical onnx}"

echo "==> build trainer"
docker compose build trainer >/dev/null

echo "==> ensure db + mlflow up"
docker compose up -d db mlflow >/dev/null
docker compose run --rm --no-deps web sh -c "npx prisma db push --skip-generate --accept-data-loss" >/dev/null 2>&1 || true

declare -A R1 R5 R10
for E in $EMBEDDERS; do
  echo "==> [$E] build index (SAMPLE_SIZE=$SUBSET) + eval (cards=$EVAL_CARDS views=$EVAL_VIEWS)"
  OUT=$(docker compose run --rm \
        -e EMBEDDER="$E" -e SAMPLE_SIZE="$SUBSET" \
        -e EVAL_CARDS="$EVAL_CARDS" -e EVAL_VIEWS="$EVAL_VIEWS" \
        trainer python main.py 2>&1 | tee /dev/stderr | grep "\[evaluation\] {" | tail -1)
  R1[$E]=$(echo "$OUT" | sed -n "s/.*'recall_at_1': \([0-9.]*\).*/\1/p")
  R5[$E]=$(echo "$OUT" | sed -n "s/.*'recall_at_5': \([0-9.]*\).*/\1/p")
  R10[$E]=$(echo "$OUT" | sed -n "s/.*'recall_at_10': \([0-9.]*\).*/\1/p")
done

echo
echo "================ BASELINE COMPARISON (index=$SUBSET, eval=${EVAL_CARDS}x${EVAL_VIEWS}) ================"
printf "%-22s %10s %10s %10s\n" "embedder" "recall@1" "recall@5" "recall@10"
for E in $EMBEDDERS; do
  printf "%-22s %10s %10s %10s\n" "$E" "${R1[$E]:-?}" "${R5[$E]:-?}" "${R10[$E]:-?}"
done
echo "=========================================================================================="
