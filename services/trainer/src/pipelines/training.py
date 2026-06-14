"""Training stage — build the pgvector reference index (the 'model').

Embeds each official card image with the shared classical descriptor and stores
the vectors in Postgres (pgvector). The pipeline shape (build a per-card vector
index) is identical to what a learned-embedding model would produce; only the
`embed` implementation would change.
"""
import os

from embedding import embed, EMBED_DIM


def _vec_literal(vec) -> str:
    return "[" + ",".join(repr(float(x)) for x in vec) + "]"


def build_index(items: list[dict], cfg) -> int:
    """Create the schema idempotently, replace this game's rows, insert all
    items, and return the inserted count."""
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise RuntimeError("DATABASE_URL is required to build the pgvector index")

    game = cfg.get("game", "pokemon")

    import psycopg2

    conn = psycopg2.connect(dsn)
    inserted = 0
    try:
        with conn, conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
            cur.execute(
                "CREATE TABLE IF NOT EXISTS card_vectors ("
                "id text PRIMARY KEY, game text NOT NULL, card_id text, "
                "name text, set_name text, number text, rarity text, "
                "type text, image_url text, embedding vector(512));"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS card_vectors_game_idx "
                "ON card_vectors(game);"
            )
            cur.execute("DELETE FROM card_vectors WHERE game = %s;", (game,))

            for it in items:
                vec = embed(it["image"])
                if len(vec) != EMBED_DIM:
                    raise ValueError(
                        f"embedding dim {len(vec)} != {EMBED_DIM} for {it['card_id']}"
                    )
                cur.execute(
                    "INSERT INTO card_vectors "
                    "(id, game, card_id, name, set_name, number, rarity, type, "
                    "image_url, embedding) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::vector)",
                    (
                        f"{game}:{it['card_id']}",
                        game,
                        it["card_id"],
                        it["name"],
                        it["set_name"],
                        it["number"],
                        it["rarity"],
                        it["type"],
                        it["image_url"],
                        _vec_literal(vec),
                    ),
                )
                inserted += 1
    finally:
        conn.close()

    print(f"[training] indexed {inserted} cards into card_vectors (game={game})")
    return inserted
