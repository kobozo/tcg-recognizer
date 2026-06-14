"""Evaluation stage — honest recall@k on synthetic phone-photos.

For a sample of indexed cards we generate held-out synthetic photos (see
photo_aug.make_photo: perspective, glare, blur, colour, JPEG), embed each with
the SAME embedder used to build the index, and run the SAME pgvector
nearest-neighbor query the inference service uses. We then check at which rank
the true card appears -> recall@1 / @5 / @10.

When `rerank_top_k > 0` we additionally geometrically re-rank the embedding
shortlist (rerank.py: ORB + RANSAC homography inliers) and report the reranked
recall@1/@5 — the sub-project 2 signal.

This replaces the old eval, which merely rotated the reference image ~7° and
matched it against itself — an almost-circular test that overstated accuracy.
"""
import os

from embedding import embed
from pipelines.ingestion import load_image
from pipelines.photo_aug import make_photo
from pipelines.rerank import rerank


def _vec_literal(vec) -> str:
    return "[" + ",".join(repr(float(x)) for x in vec) + "]"


def evaluate(items: list[dict], index_count: int, cfg) -> dict:
    game = cfg.get("game", "pokemon")
    dim = int(cfg.get("embed_dim", 512))
    eval_cards = int(cfg.get("eval_cards", 300))
    eval_views = int(cfg.get("eval_views", 3))
    base_seed = int(cfg.get("eval_seed", 1234))
    rerank_top_k = int(cfg.get("rerank_top_k", 0))

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise RuntimeError("DATABASE_URL is required to evaluate the pgvector index")

    # Sample the eval cards evenly across the indexed set (stride).
    n = len(items)
    k = min(eval_cards, n)
    sample = list(items) if n <= k else [items[int(i * n / k)] for i in range(k)]

    # Map index id -> item, so the re-ranker can load candidate reference images.
    by_id = {f"{game}:{it['card_id']}": it for it in items}
    ref_cache: dict[str, object] = {}

    def ref_image(cid):
        if cid not in ref_cache:
            it = by_id.get(cid)
            try:
                ref_cache[cid] = load_image(it) if it else None
            except Exception:  # noqa: BLE001
                ref_cache[cid] = None
        return ref_cache[cid]

    import psycopg2

    fetch = max(10, rerank_top_k)
    conn = psycopg2.connect(dsn)
    hit1 = hit5 = hit10 = 0
    rr1 = rr5 = 0
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
                        "ORDER BY embedding <=> %s::vector LIMIT %s;",
                        (game, _vec_literal(vec), fetch),
                    )
                    rows = [r[0] for r in cur.fetchall()]
                    total += 1
                    if rows and rows[0] == target:
                        hit1 += 1
                    if target in rows[:5]:
                        hit5 += 1
                    if target in rows[:10]:
                        hit10 += 1

                    if rerank_top_k > 0 and rows:
                        cands = [(cid, ref_image(cid)) for cid in rows]
                        cands = [(cid, im) for cid, im in cands if im is not None]
                        reordered = [cid for cid, _ in rerank(photo, cands, rerank_top_k)]
                        if reordered and reordered[0] == target:
                            rr1 += 1
                        if target in reordered[:5]:
                            rr5 += 1
                if (idx + 1) % 100 == 0:
                    msg = f"recall@1 {round(hit1 / max(1, total), 3)}"
                    if rerank_top_k > 0:
                        msg += f" | rerank@1 {round(rr1 / max(1, total), 3)}"
                    print(f"[evaluation] {idx + 1}/{k} cards, {msg}")
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
    if rerank_top_k > 0:
        metrics["rerank_top_k"] = rerank_top_k
        metrics["rerank_recall_at_1"] = round(rr1 / t, 4)
        metrics["rerank_recall_at_5"] = round(rr5 / t, 4)
    print(f"[evaluation] {metrics}")
    return metrics
