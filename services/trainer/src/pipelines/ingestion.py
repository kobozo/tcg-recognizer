"""Ingestion stage — assemble the card list for the index.

Mirrors the course's pipeline split (ingestion -> training -> evaluation).

Source precedence:
  1. Local dataset manifest ($DATASET_DIR/<game>/manifest.jsonl) — the full
     pre-downloaded catalogue (see pipelines/download.py). Items carry an
     `image_path` and are loaded lazily during training/evaluation, so a
     20k-card dataset never has to sit decoded in memory.
  2. Live API sample — fetch `sample_size` cards and decode their images in
     memory (used when no local dataset is present).
  3. Synthetic fallback — colored images, so a rebuild never hard-fails.

`sample_size` may be an int (cap) or the string "all"/0 to use the entire
manifest.
"""
import io
import json
import os

import requests
from PIL import Image


def _dataset_paths(game: str) -> tuple[str, str]:
    base = os.environ.get("DATASET_DIR", "/data")
    game_dir = os.path.join(base, game)
    return game_dir, os.path.join(game_dir, "manifest.jsonl")


def _cap(sample_size) -> int | None:
    """Return an int cap, or None for 'use everything'."""
    if isinstance(sample_size, str):
        if sample_size.strip().lower() in ("all", "", "0"):
            return None
        return int(sample_size)
    if sample_size in (0, None):
        return None
    return int(sample_size)


def load_image(item: dict) -> Image.Image:
    """Lazily resolve a card's PIL image: in-memory if present, else from disk."""
    img = item.get("image")
    if img is not None:
        return img
    return Image.open(item["image_path"]).convert("RGB")


def _ingest_from_manifest(game: str, manifest_path: str, cap: int | None) -> list[dict]:
    game_dir, _ = _dataset_paths(game)
    base = os.environ.get("DATASET_DIR", "/data")
    items: list[dict] = []
    with open(manifest_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            rel = rec.get("image_path")
            if not rel:
                continue
            abs_path = os.path.join(base, rel)
            if not (os.path.exists(abs_path) and os.path.getsize(abs_path) > 0):
                continue
            items.append(
                {
                    "card_id": rec["card_id"],
                    "name": rec.get("name", ""),
                    "set_name": rec.get("set_name", ""),
                    "number": rec.get("number", ""),
                    "rarity": rec.get("rarity", ""),
                    "type": rec.get("type", ""),
                    "image_url": rec.get("image_url", ""),
                    "image_path": abs_path,
                }
            )
            if cap is not None and len(items) >= cap:
                break
    return items


def _ingest_from_api(n: int) -> list[dict]:
    items: list[dict] = []
    url = (
        "https://api.pokemontcg.io/v2/cards"
        f"?pageSize={n}&select=id,name,set,number,rarity,types,images"
    )
    r = requests.get(url, timeout=20)
    r.raise_for_status()
    for c in r.json().get("data", []):
        images = c.get("images") or {}
        src = images.get("small")
        if not src:
            continue
        ir = requests.get(src, timeout=20)
        if not ir.ok:
            continue
        img = Image.open(io.BytesIO(ir.content)).convert("RGB")
        types = c.get("types") or []
        items.append(
            {
                "card_id": c["id"],
                "name": c.get("name", ""),
                "set_name": (c.get("set") or {}).get("name", ""),
                "number": c.get("number", ""),
                "rarity": c.get("rarity", ""),
                "type": types[0] if types else "",
                "image_url": src,
                "image": img,
            }
        )
    return items


def ingest(cfg) -> list[dict]:
    """Return a list of card dicts. Each carries either an in-memory `image`
    (API/synthetic) or an `image_path` (local manifest); use load_image()."""
    game = cfg.get("game", "pokemon")
    cap = _cap(cfg.get("sample_size", 30))

    _, manifest_path = _dataset_paths(game)
    if os.path.exists(manifest_path):
        try:
            items = _ingest_from_manifest(game, manifest_path, cap)
        except Exception as e:  # noqa: BLE001 - fall back to API/synthetic
            print(f"[ingestion] manifest read failed ({e}); trying API")
            items = []
        if items:
            print(
                f"[ingestion] {len(items)} cards from manifest "
                f"(cap={cap}) for game={game}"
            )
            return items
        print("[ingestion] manifest present but empty/unreadable; trying API")

    n = cap if cap is not None else 30
    try:
        items = _ingest_from_api(n)
    except Exception as e:  # noqa: BLE001 - best effort
        print(f"[ingestion] API failed ({e}); using synthetic fallback")
        items = []

    if not items:
        for i in range(n):
            color = ((i * 5) % 255, (i * 9) % 255, (i * 13) % 255)
            img = Image.new("RGB", (245, 342), color)
            items.append(
                {
                    "card_id": f"syn{i}",
                    "name": f"Synthetic Card {i}",
                    "set_name": "Synthetic Set",
                    "number": str(i),
                    "rarity": "Common",
                    "type": "Colorless",
                    "image_url": "",
                    "image": img,
                }
            )

    print(f"[ingestion] {len(items)} cards for game={game}")
    return items
