#!/usr/bin/env bash
# Run any `dvc` subcommand for this repo (sub-project 4).
#
# DVC resolution order:
#   1. a native `dvc` on PATH;
#   2. `uvx dvc` — runs DVC in an ephemeral uv-managed env (no global install;
#      this is the path on this box, which has `uv` but no pip);
#   3. a one-off trainer container with the host repo bind-mounted (for hosts
#      that have neither dvc nor uv, but do have Docker).
#
# Prefer 1/2 (host-native): the `train` stage shells out to `docker compose`,
# which is simplest when dvc runs on the host (no docker-in-docker).
#
# Usage:
#   bash scripts/dvc.sh init
#   bash scripts/dvc.sh remote add -d local "$PWD/.dvc-remote"
#   bash scripts/dvc.sh add ml/datasets/pokemon
#   bash scripts/dvc.sh repro          # runs the pipeline (real trainer run)
#   bash scripts/dvc.sh metrics show
#   bash scripts/dvc.sh push           # data -> ./.dvc-remote
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[ -f .env ] || cp .env.example .env
mkdir -p .dvc-remote

if command -v dvc >/dev/null 2>&1; then
  exec dvc "$@"
elif command -v uvx >/dev/null 2>&1; then
  # Pin DVC to 3.x; uvx caches the env after first use.
  exec uvx --from "dvc==3.*" dvc "$@"
else
  echo "==> no host dvc/uvx; running dvc in the trainer container" >&2
  if ! docker image inspect project-trainer >/dev/null 2>&1; then
    docker compose build trainer >&2
  fi
  exec docker compose run --rm --no-deps \
    -v "$ROOT:/repo" -w /repo --entrypoint dvc trainer "$@"
fi
