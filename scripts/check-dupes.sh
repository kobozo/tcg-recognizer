#!/usr/bin/env bash
# Guard the intentional byte-for-byte duplication invariant.
#
# embedding.py and rerank.py are deliberately copied between services/trainer
# and services/inference (separate Docker build contexts that MUST agree on the
# embedding so pgvector nearest-neighbor search stays meaningful). This script
# fails if either pair has diverged, so CI catches an accidental edit to only
# one copy.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

status=0
check() {
  local a="$1" b="$2"
  if diff -u "$a" "$b"; then
    echo "OK: $a == $b"
  else
    echo "DIVERGED: $a != $b" >&2
    status=1
  fi
}

check services/trainer/src/embedding.py services/inference/app/embedding.py
check services/trainer/src/pipelines/rerank.py services/inference/app/rerank.py

exit "$status"
