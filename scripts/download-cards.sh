#!/usr/bin/env bash
# Download the full card-image dataset into the local cache (ml/datasets,
# git-ignored), then it's reused by every training run.
#
#   bash scripts/download-cards.sh                 # all cards, small images
#   IMAGE_SIZE=large bash scripts/download-cards.sh
#   DOWNLOAD_LIMIT=200 bash scripts/download-cards.sh   # quick smoke subset
#
# Runs inside the trainer image (deps preinstalled). --no-deps: the download
# needs neither Postgres nor MLflow.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[ -f .env ] || cp .env.example .env
mkdir -p ml/datasets

echo "==> building trainer image"
docker compose build trainer

echo "==> downloading dataset (IMAGE_SIZE=${IMAGE_SIZE:-small} DOWNLOAD_LIMIT=${DOWNLOAD_LIMIT:-<all>})"
docker compose run --rm --no-deps \
  -e DATASET_DIR=/data \
  -e IMAGE_SIZE="${IMAGE_SIZE:-small}" \
  -e DOWNLOAD_LIMIT="${DOWNLOAD_LIMIT:-}" \
  -e DOWNLOAD_WORKERS="${DOWNLOAD_WORKERS:-16}" \
  trainer python download.py

echo
echo "Done. Manifest: ml/datasets/pokemon/manifest.jsonl"
echo "Train on it:    docker compose run --rm trainer   (config sample_size: all)"
