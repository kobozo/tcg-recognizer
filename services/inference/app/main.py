"""TCG inference service.

Pipeline: uploaded photo -> deskew -> classical visual embedding ->
pgvector nearest-neighbor over the `card_vectors` index built by the trainer.

Robust by design: any DB problem (missing DATABASE_URL, missing table, query
error, zero rows) falls back to a per-game stub. /predict never returns 500 on
a DB issue.
"""
import io
import json
import os

from fastapi import FastAPI, UploadFile, File, Form
from PIL import Image

from app.embedding import deskew, embed, EMBED_DIM

app = FastAPI(title="TCG Inference")

MODEL_VERSION = "embed-v1"   # version reported when a real DB match is used
STUB_VERSION = "stub-0"      # version reported when falling back to the stub


def field(value, conf):
    return {"value": value, "conf": conf}


# Per-game placeholder predictions used when the pgvector index is unavailable.
STUBS = {
    "pokemon": {
        "name": {"candidates": [field("Charizard", 0.93)], **field("Charizard", 0.93)},
        "type": field("Fire", 0.97),
        "set": field("Base", 0.74),
        "rarity": field("Rare Holo", 0.81),
        "card_number": field("4/102", 0.66),
    },
    "magic": {
        "name": {"candidates": [field("Sol Ring", 0.9)], **field("Sol Ring", 0.9)},
        "type": field("Artifact", 0.95),
        "set": field("Commander", 0.7),
        "rarity": field("Uncommon", 0.8),
        "card_number": field("232", 0.6),
    },
}


def _stub_response(game: str) -> dict:
    stub = STUBS.get(game, STUBS["pokemon"])
    return {**stub, "game": game, "model_version": STUB_VERSION}


def _vec_literal(vec) -> str:
    """Render an embedding as a pgvector string literal: '[0.1,0.2,...]'."""
    return "[" + ",".join(repr(float(x)) for x in vec) + "]"


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, float(x)))


def _query_index(vec, game: str):
    """Run the pgvector NN query. Returns rows or None on any failure."""
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        return None
    try:
        import psycopg2
    except Exception:
        return None
    lit = _vec_literal(vec)
    conn = None
    try:
        conn = psycopg2.connect(dsn)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT name, set_name, number, rarity, type, image_url, "
                "1 - (embedding <=> %s::vector) AS sim "
                "FROM card_vectors WHERE game = %s "
                "ORDER BY embedding <=> %s::vector LIMIT 5;",
                (lit, game, lit),
            )
            rows = cur.fetchall()
        return rows or None
    except Exception as e:  # noqa: BLE001 - any DB error -> stub fallback
        print(f"[predict] DB query failed; using stub: {e}")
        return None
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


def _active_embedder() -> str:
    """Which embedding backend embed() will dispatch to (see app.embedding)."""
    return "onnx" if os.environ.get("EMBEDDER", "classical").strip().lower() == "onnx" else "classical"


@app.get("/health")
def health():
    return {"status": "ok", "model_version": MODEL_VERSION, "embedder": _active_embedder()}


@app.get("/model")
def model():
    return {
        "version": MODEL_VERSION,
        "metrics": {},
        "is_current": True,
        "embedder": _active_embedder(),
    }


def _parse_embedding(embedding: str | None):
    """Parse the optional precomputed-embedding form field.

    Expects a JSON array of exactly EMBED_DIM finite floats. Returns the list
    of floats, or None if absent/invalid (in which case the caller falls back
    to server-side deskew+embed).
    """
    if not embedding:
        return None
    try:
        parsed = json.loads(embedding)
    except Exception:
        return None
    if not isinstance(parsed, (list, tuple)) or len(parsed) != EMBED_DIM:
        return None
    try:
        vec = [float(x) for x in parsed]
    except Exception:
        return None
    # Reject NaN/inf so the pgvector literal stays valid.
    if any(v != v or v in (float("inf"), float("-inf")) for v in vec):
        return None
    return vec


@app.post("/predict")
async def predict(
    image: UploadFile | None = File(None),
    game: str = Form("pokemon"),
    embedding: str | None = Form(None),
):
    # Fast path: a valid client-precomputed embedding skips server vision work.
    vec = _parse_embedding(embedding)

    if vec is None:
        # No usable precomputed embedding: we need an image to embed.
        if image is None:
            return _stub_response(game)
        raw = await image.read()

        # Decode -> deskew -> embed. Any decode failure falls back to the stub.
        try:
            pil = Image.open(io.BytesIO(raw)).convert("RGB")
        except Exception:
            return _stub_response(game)

        try:
            pil = deskew(pil)
            vec = embed(pil)
        except Exception as e:  # noqa: BLE001 - never 500 on a vision error
            print(f"[predict] embedding failed; using stub: {e}")
            return _stub_response(game)

    rows = _query_index(vec, game)
    if not rows:
        return _stub_response(game)

    # rows[i] = (name, set_name, number, rarity, type, image_url, sim)
    top = rows[0]
    top_sim = _clamp01(top[6])
    candidates = [
        {"value": r[0], "conf": _clamp01(r[6])} for r in rows[:3]
    ]

    return {
        "name": {"value": top[0], "conf": top_sim, "candidates": candidates},
        "type": {"value": top[4], "conf": top_sim},
        "set": {"value": top[1], "conf": top_sim},
        "rarity": {"value": top[3], "conf": top_sim},
        "card_number": {"value": top[2], "conf": top_sim},
        "image_url": top[5],
        "game": game,
        "model_version": MODEL_VERSION,
        # The embedding used — persisted on the scan so confirmed feedback can be
        # fed back into the index (active-learning flywheel).
        "embedding": [float(x) for x in vec],
    }
