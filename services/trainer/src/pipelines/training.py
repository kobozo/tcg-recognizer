"""Training stage — build the reference index (the 'model').

Baseline: perceptual hashes (pHash). Phase 3 replaces this with CLIP embeddings;
the pipeline shape (build a per-card vector index) stays identical.
"""
import imagehash


def build_index(items: list[dict], cfg) -> list[dict]:
    hs = int(cfg["model"]["hash_size"])
    index = [
        {"id": it["id"], "name": it["name"], "hash": str(imagehash.phash(it["image"], hash_size=hs))}
        for it in items
    ]
    print(f"[training] indexed {len(index)} cards (phash hash_size={hs})")
    return index
