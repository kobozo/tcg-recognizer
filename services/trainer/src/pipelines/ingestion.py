"""Ingestion stage — pull a sample of official card images for the index.

Mirrors the course's pipeline split (ingestion -> training -> evaluation). Falls
back to a synthetic set if the API is unreachable so a rebuild never hard-fails.
"""
import io

import requests
from PIL import Image


def ingest(cfg) -> list[dict]:
    n = int(cfg["sample_size"])
    items: list[dict] = []
    try:
        url = f"https://api.pokemontcg.io/v2/cards?pageSize={n}&select=id,name,images"
        r = requests.get(url, timeout=20)
        r.raise_for_status()
        for c in r.json().get("data", []):
            src = (c.get("images") or {}).get("small")
            if not src:
                continue
            ir = requests.get(src, timeout=20)
            if ir.ok:
                img = Image.open(io.BytesIO(ir.content)).convert("RGB")
                items.append({"id": c["id"], "name": c["name"], "image": img})
    except Exception as e:  # noqa: BLE001 - best effort
        print(f"[ingestion] API failed ({e}); using synthetic fallback")

    if not items:
        for i in range(n):
            img = Image.new("RGB", (64, 89), ((i * 5) % 255, (i * 9) % 255, (i * 13) % 255))
            items.append({"id": f"syn{i}", "name": f"Synthetic Card {i}", "image": img})

    print(f"[ingestion] {len(items)} cards")
    return items
