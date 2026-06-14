"""Evaluation stage — recall@1 on perturbed held-out cards (a real-photo proxy).

Held-out cards are rotated/resized to mimic a phone photo, then matched back
against the index by nearest hash. This is the course's held-out-test discipline.
"""
import imagehash


def evaluate(items: list[dict], index: list[dict], cfg) -> dict:
    hs = int(cfg["model"]["hash_size"])
    hashes = {e["id"]: imagehash.hex_to_hash(e["hash"]) for e in index}
    holdout = items[: int(cfg["holdout"])]

    correct = 0
    for it in holdout:
        photo = it["image"].rotate(7, expand=True).resize((60, 84))
        q = imagehash.phash(photo, hash_size=hs)
        best_id = min(hashes.items(), key=lambda kv: q - kv[1])[0]
        if best_id == it["id"]:
            correct += 1

    n = max(1, len(holdout))
    metrics = {
        "recall_at_1": round(correct / n, 3),
        "dataset_size": len(items),
        "holdout": len(holdout),
    }
    print(f"[evaluation] {metrics}")
    return metrics
