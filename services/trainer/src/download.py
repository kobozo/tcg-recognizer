"""CLI entry: download the full card-image dataset to the local cache.

Run inside the trainer container (deps already installed):

    docker compose run --rm --no-deps \
      -e DATASET_DIR=/data trainer python download.py

Config via env:
  DATASET_DIR      where to write the cache (default /data; bind-mounted to
                   ./ml/datasets on the host — git-ignored).
  IMAGE_SIZE       "small" (default) or "large".
  DOWNLOAD_LIMIT   optional integer cap (handy for a quick smoke run).
  DOWNLOAD_WORKERS concurrent image downloads (default 16).
  POKEMON_TCG_API_KEY  optional; raises the API rate limit.
"""
import os

from pipelines.download import download_all


def _int_env(name: str, default: int | None) -> int | None:
    """Parse an int env var, falling back to default on empty/invalid input."""
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        print(f"[download] ignoring invalid {name}={raw!r}; using {default}")
        return default


def main() -> None:
    game = os.environ.get("GAME", "pokemon")
    dataset_dir = os.environ.get("DATASET_DIR", "/data")
    image_size = os.environ.get("IMAGE_SIZE", "small")
    api_key = os.environ.get("POKEMON_TCG_API_KEY", "").strip() or None
    workers = _int_env("DOWNLOAD_WORKERS", 16) or 16
    limit = _int_env("DOWNLOAD_LIMIT", None)

    download_all(
        game=game,
        dataset_dir=dataset_dir,
        image_size=image_size,
        api_key=api_key,
        limit=limit,
        workers=workers,
    )


if __name__ == "__main__":
    main()
