"""Ingestion stage — pull a sample of official card images for the index.

Mirrors the course's pipeline split (ingestion -> training -> evaluation).
Fetches official cards from the Pokemon TCG API and downloads each card's
`images.small` into a PIL image. Best-effort: on API/network failure it falls
back to a small synthetic set (colored images) so a rebuild never hard-fails.
"""
import io

import requests
from PIL import Image


def ingest(cfg) -> list[dict]:
    """Return a list of dicts:
    {card_id, name, set_name, number, rarity, type, image_url, image}.
    """
    n = int(cfg["sample_size"])
    game = cfg.get("game", "pokemon")
    items: list[dict] = []

    try:
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
    except Exception as e:  # noqa: BLE001 - best effort
        print(f"[ingestion] API failed ({e}); using synthetic fallback")

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
