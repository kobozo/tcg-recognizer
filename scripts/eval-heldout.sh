#!/usr/bin/env bash
# Sub-project 7 — HONEST held-out-CARD recognition eval.
#
# The SP3 learned head (/models/head.npz) was trained on the FIRST ~3000 manifest
# cards. Evaluating on those same cards measures fit, not generalization. This
# script indexes + evaluates a card range DISJOINT from the head's training set
# (SAMPLE_OFFSET past the trained cards), so the eval cards are genuinely UNSEEN
# by the head. It runs the eval twice — once WITH the head, once WITHOUT (zero-
# shot DINOv2) — and prints a recall@1/@5/@10 comparison. A head that helps here
# generalizes; one that only helps on trained cards has merely memorized them.
#
#   bash scripts/eval-heldout.sh
#   SAMPLE_OFFSET=4000 SAMPLE_SIZE=1500 EVAL_CARDS=400 bash scripts/eval-heldout.sh
#   RERANK_TOP_K=10 bash scripts/eval-heldout.sh          # also report rerank@1/@5
#
# IMPORTANT: HEAD_TRAIN_CARDS must be < SAMPLE_OFFSET so the eval cards are truly
# unseen by the head. The head in this repo trained on the first 3000 cards, so
# the default SAMPLE_OFFSET=4000 leaves a safe gap. If you retrained the head
# with a larger HEAD_TRAIN_CARDS, bump SAMPLE_OFFSET above it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[ -f .env ] || cp .env.example .env

SAMPLE_OFFSET="${SAMPLE_OFFSET:-4000}"   # skip the first N manifest cards (trained range)
SAMPLE_SIZE="${SAMPLE_SIZE:-1500}"       # held-out cards to index/eval
EVAL_CARDS="${EVAL_CARDS:-400}"
EVAL_VIEWS="${EVAL_VIEWS:-2}"
EVAL_SEED="${EVAL_SEED:-1234}"
RERANK_TOP_K="${RERANK_TOP_K:-0}"
HEAD="${EMBED_HEAD:-/models/head.npz}"   # head artifact to test

echo "==> HELD-OUT-CARD eval: offset=$SAMPLE_OFFSET size=$SAMPLE_SIZE (cards UNSEEN by the head)"
echo "    eval=${EVAL_CARDS}x${EVAL_VIEWS}  rerank_top_k=$RERANK_TOP_K  head=$HEAD"

echo "==> build trainer"
docker compose build trainer >/dev/null

echo "==> ensure db up + migrations"
docker compose up -d db >/dev/null
docker compose run --rm --no-deps web sh -c \
  "npx prisma db push --skip-generate --accept-data-loss" >/dev/null 2>&1 || true

# Run one configuration: $1 = label, $2 = EMBED_HEAD value ("" disables the head).
# Rebuilds card_vectors over the held-out range with the given embedder (index
# vectors must match the query embedder), then runs the eval on that same range.
# METRICS_PATH -> /tmp so this never clobbers the tracked DVC metric; run as the
# host user so any artifacts are host-owned (pattern from e2e-recognition-card).
run_cfg() {
  local label="$1" head="$2"
  echo "==> [$label] build index + eval over held-out cards"
  docker compose run --rm --user "$(id -u):$(id -g)" \
    -e EMBEDDER=onnx -e EMBED_HEAD="$head" \
    -e SAMPLE_OFFSET="$SAMPLE_OFFSET" -e SAMPLE_SIZE="$SAMPLE_SIZE" \
    -e EVAL_CARDS="$EVAL_CARDS" -e EVAL_VIEWS="$EVAL_VIEWS" -e EVAL_SEED="$EVAL_SEED" \
    -e RERANK_TOP_K="$RERANK_TOP_K" \
    -e METRICS_PATH=/tmp/heldout-metrics.json \
    trainer python main.py 2>&1 | tee /dev/stderr | grep "\[evaluation\] {" | tail -1
}

OUT_NOHEAD="$(run_cfg 'DINOv2 zero-shot (no head)' '')"
OUT_HEAD="$(run_cfg 'DINOv2 + learned head' "$HEAD")"

pick() { echo "$1" | sed -n "s/.*'$2': \([0-9.]*\).*/\1/p"; }

echo
echo "============ HELD-OUT-CARD RECALL (offset=$SAMPLE_OFFSET, size=$SAMPLE_SIZE, eval=${EVAL_CARDS}x${EVAL_VIEWS}) ============"
printf "%-26s %10s %10s %10s\n" "config" "recall@1" "recall@5" "recall@10"
printf "%-26s %10s %10s %10s\n" "DINOv2 zero-shot" \
  "$(pick "$OUT_NOHEAD" recall_at_1)" "$(pick "$OUT_NOHEAD" recall_at_5)" "$(pick "$OUT_NOHEAD" recall_at_10)"
printf "%-26s %10s %10s %10s\n" "DINOv2 + learned head" \
  "$(pick "$OUT_HEAD" recall_at_1)" "$(pick "$OUT_HEAD" recall_at_5)" "$(pick "$OUT_HEAD" recall_at_10)"
if [ "$RERANK_TOP_K" -gt 0 ]; then
  printf "%-26s %10s %10s %10s\n" "  + geometric rerank" \
    "$(pick "$OUT_HEAD" rerank_recall_at_1)" "$(pick "$OUT_HEAD" rerank_recall_at_5)" "-"
fi
echo "=============================================================================================="
echo "These cards were NEVER seen by the head during training (offset>${SAMPLE_OFFSET} past the"
echo "first ~3000 trained cards). A head that lifts recall here GENERALIZES to unseen cards."
