#!/usr/bin/env bash
# `download` stage command for dvc.yaml (sub-project 4).
#
# Thin wrapper over the existing dataset downloader so the full card-image cache
# (ml/datasets/pokemon) can be (re)materialised as a pipeline stage. Honours the
# same env knobs as scripts/download-cards.sh.
#
#   bash scripts/dvc-download.sh
#   DOWNLOAD_LIMIT=200 bash scripts/dvc-download.sh   # quick subset
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[ -f .env ] || cp .env.example .env
mkdir -p ml/datasets

echo "==> building trainer image"
docker compose build trainer >/dev/null

echo "==> downloading dataset (IMAGE_SIZE=${IMAGE_SIZE:-small} DOWNLOAD_LIMIT=${DOWNLOAD_LIMIT:-<all>})"
docker compose run --rm --no-deps \
  -e DATASET_DIR=/data \
  -e IMAGE_SIZE="${IMAGE_SIZE:-small}" \
  -e DOWNLOAD_LIMIT="${DOWNLOAD_LIMIT:-}" \
  -e DOWNLOAD_WORKERS="${DOWNLOAD_WORKERS:-16}" \
  trainer python download.py

echo "==> done. manifest: ml/datasets/pokemon/manifest.jsonl"
