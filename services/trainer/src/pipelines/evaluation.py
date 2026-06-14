"""Evaluation stage — recall@1 on perturbed held-out cards (a real-photo proxy).

Each held-out card image is rotated (~7 degrees) and resized to mimic a phone
photo, embedded, then matched back against the pgvector index with the SAME
nearest-neighbor query the inference service uses. We check whether the top row
is the held-out card itself.
"""
import os

from embedding import embed
from pipelines.ingestion import load_image


def _vec_literal(vec) -> str:
    return "[" + ",".join(repr(float(x)) for x in vec) + "]"


def evaluate(items: list[dict], index_count: int, cfg) -> dict:
    game = cfg.get("game", "pokemon")
    dim = int(cfg.get("embed_dim", 512))

    # Sample the holdout evenly across the whole dataset (stride) rather than
    # taking the first N — otherwise the eval would only ever cover one set.
    k = max(1, int(cfg["holdout"]))
    if len(items) <= k:
        holdout = list(items)
    else:
        step = len(items) / k
        holdout = [items[int(j * step)] for j in range(k)]

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise RuntimeError("DATABASE_URL is required to evaluate the pgvector index")

    import psycopg2

    conn = psycopg2.connect(dsn)
    correct = 0
    try:
        with conn.cursor() as cur:
            for it in holdout:
                try:
                    base_img = load_image(it)
                except Exception as e:  # noqa: BLE001 - skip unreadable images
                    print(f"[evaluation] skip {it['card_id']}: {e}")
                    continue
                # Perturb to mimic a phone photo *after deskew*: a small
                # rotation (white-filled, no black expand borders that would
                # swamp the descriptor) plus a resize. This is the regime the
                # inference service sees, since /predict deskews first.
                photo = base_img.rotate(7, expand=False, fillcolor=(255, 255, 255))
                w, h = photo.size
                photo = photo.resize((max(1, int(w * 0.8)), max(1, int(h * 0.8))))

                vec = embed(photo)
                cur.execute(
                    "SELECT id FROM card_vectors WHERE game = %s "
                    "ORDER BY embedding <=> %s::vector LIMIT 1;",
                    (game, _vec_literal(vec)),
                )
                row = cur.fetchone()
                if row and row[0] == f"{game}:{it['card_id']}":
                    correct += 1
    finally:
        conn.close()

    n = max(1, len(holdout))
    metrics = {
        "recall_at_1": round(correct / n, 3),
        "dataset_size": len(items),
        "holdout": len(holdout),
        "dim": dim,
    }
    print(f"[evaluation] {metrics}")
    return metrics
