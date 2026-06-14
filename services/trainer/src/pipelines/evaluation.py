"""Evaluation stage — honest recall@k on synthetic phone-photos.

For a sample of indexed cards we generate held-out synthetic photos (see
photo_aug.make_photo: perspective, glare, blur, colour, JPEG), embed each with
the SAME embedder used to build the index, and run the SAME pgvector
nearest-neighbor query the inference service uses. We then check at which rank
the true card appears -> recall@1 / @5 / @10.

This replaces the old eval, which merely rotated the reference image ~7° and
matched it against itself — an almost-circular test that overstated accuracy.
"""
import os

from embedding import embed
from pipelines.ingestion import load_image
from pipelines.photo_aug import make_photo


def _vec_literal(vec) -> str:
    return "[" + ",".join(repr(float(x)) for x in vec) + "]"


def evaluate(items: list[dict], index_count: int, cfg) -> dict:
    game = cfg.get("game", "pokemon")
    dim = int(cfg.get("embed_dim", 512))
    eval_cards = int(cfg.get("eval_cards", 300))
    eval_views = int(cfg.get("eval_views", 3))
    base_seed = int(cfg.get("eval_seed", 1234))

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise RuntimeError("DATABASE_URL is required to evaluate the pgvector index")

    # Sample the eval cards evenly across the indexed set (stride), so the eval
    # spans many sets rather than one.
    n = len(items)
    k = min(eval_cards, n)
    if n <= k:
        sample = list(items)
    else:
        step = n / k
        sample = [items[int(i * step)] for i in range(k)]

    import psycopg2

    conn = psycopg2.connect(dsn)
    hit1 = hit5 = hit10 = 0
    total = 0
    try:
        with conn.cursor() as cur:
            for idx, it in enumerate(sample):
                try:
                    base = load_image(it)
                except Exception as e:  # noqa: BLE001 - skip unreadable images
                    print(f"[evaluation] skip {it['card_id']}: {e}")
                    continue
                target = f"{game}:{it['card_id']}"
                for v in range(eval_views):
                    photo = make_photo(base, seed=base_seed + idx * 100 + v)
                    vec = embed(photo)
                    cur.execute(
                        "SELECT id FROM card_vectors WHERE game = %s "
                        "ORDER BY embedding <=> %s::vector LIMIT 10;",
                        (game, _vec_literal(vec)),
                    )
                    rows = [r[0] for r in cur.fetchall()]
                    total += 1
                    if rows and rows[0] == target:
                        hit1 += 1
                    if target in rows[:5]:
                        hit5 += 1
                    if target in rows[:10]:
                        hit10 += 1
                if (idx + 1) % 100 == 0:
                    print(f"[evaluation] {idx + 1}/{k} cards, recall@1 so far "
                          f"{round(hit1 / max(1, total), 3)}")
    finally:
        conn.close()

    t = max(1, total)
    metrics = {
        "recall_at_1": round(hit1 / t, 4),
        "recall_at_5": round(hit5 / t, 4),
        "recall_at_10": round(hit10 / t, 4),
        "eval_queries": total,
        "eval_cards": k,
        "eval_views": eval_views,
        "dataset_size": len(items),
        "dim": dim,
    }
    print(f"[evaluation] {metrics}")
    return metrics
