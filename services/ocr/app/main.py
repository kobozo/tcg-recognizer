"""OCR text-search subsystem (opt-in `extras` channel) — backed by pgvector.

OCRs cards into text, vectorizes that text with a deterministic, model-free
character/token n-gram hashing embedder, and stores/searches it in
**PostgreSQL + pgvector** — the same vector store the core recognizer uses (no
separate vector database). It is an *extra* candidate channel for the
recognition flywheel, CPU-only, and gated behind the Docker Compose `extras`
profile so the default stack is untouched.

Every DB / network call is defensive: the service stays up (returning empty
results) even if Postgres is briefly unavailable or an image is malformed.
"""
from __future__ import annotations

import io
import os
import re
from typing import Any

import numpy as np
import requests
from fastapi import FastAPI, File, Form, Request, UploadFile

# psycopg2 is imported defensively so the module still imports even if the
# driver is missing (the channel then simply returns empty results).
try:
    import psycopg2
except Exception:  # pragma: no cover - defensive import
    psycopg2 = None  # type: ignore

# ----------------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------------
DATABASE_URL = os.environ.get("DATABASE_URL", "")
TABLE = "card_text_vectors"
VECTOR_SIZE = 256
POKEMON_API = "https://api.pokemontcg.io/v2/cards"
POKEMON_API_KEY = os.environ.get("POKEMON_TCG_API_KEY", "").strip()

app = FastAPI(title="tcg-ocr", version="2.0.0")


# ----------------------------------------------------------------------------
# Deterministic, model-free text embedder
# ----------------------------------------------------------------------------
def text_embed(text: str) -> list[float]:
    """256-dim deterministic text vector.

    Lowercases, keeps [a-z0-9 ], then hashes both character 3-grams and whole
    tokens into 256 buckets (counts), and L2-normalizes. Sub-token (3-gram)
    features make it robust to fuzzy / partial matches: a query like
    "charizard" overlaps heavily with a document like
    "charizard 4/102 base fire", yielding a high cosine.
    """
    vec = np.zeros(VECTOR_SIZE, dtype=np.float64)
    if not text:
        return vec.tolist()

    cleaned = re.sub(r"[^a-z0-9 ]", " ", text.lower())
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if not cleaned:
        return vec.tolist()

    def bucket(s: str) -> int:
        # Stable, process-independent hash (Python's str hash is salted).
        h = 1469598103934665603  # FNV-1a 64-bit offset basis
        for ch in s.encode("utf-8"):
            h ^= ch
            h = (h * 1099511628211) & 0xFFFFFFFFFFFFFFFF
        return h % VECTOR_SIZE

    # Whole-token features.
    tokens = cleaned.split(" ")
    for tok in tokens:
        if tok:
            vec[bucket("tok:" + tok)] += 1.0

    # Character 3-gram features (over the space-joined, padded token stream).
    padded = " " + " ".join(tokens) + " "
    for i in range(len(padded) - 2):
        gram = padded[i : i + 3]
        if gram.strip():
            vec[bucket("g3:" + gram)] += 1.0

    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    return vec.tolist()


# ----------------------------------------------------------------------------
# pgvector storage (all defensive)
# ----------------------------------------------------------------------------
def _vec_literal(vec: list[float]) -> str:
    return "[" + ",".join(repr(float(x)) for x in vec) + "]"


def _connect():
    """Open a Postgres connection, or None on any failure."""
    if psycopg2 is None or not DATABASE_URL:
        return None
    try:
        return psycopg2.connect(DATABASE_URL, connect_timeout=5)
    except Exception:
        return None


def ensure_schema() -> bool:
    """Create the pgvector extension + text-vector table on first use."""
    conn = _connect()
    if conn is None:
        return False
    try:
        with conn, conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
            cur.execute(
                f"CREATE TABLE IF NOT EXISTS {TABLE} ("
                "id text PRIMARY KEY, game text NOT NULL, card_id text, "
                "name text, set_name text, number text, "
                f"embedding vector({VECTOR_SIZE}));"
            )
            cur.execute(f"CREATE INDEX IF NOT EXISTS {TABLE}_game_idx ON {TABLE}(game);")
        return True
    except Exception:
        return False
    finally:
        conn.close()


def _search(query: str, game: str, limit: int) -> list[dict[str, Any]]:
    if not ensure_schema():
        return []
    conn = _connect()
    if conn is None:
        return []
    lit = _vec_literal(text_embed(query))
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT name, set_name, number, 1 - (embedding <=> %s::vector) AS score "
                f"FROM {TABLE} WHERE game = %s "
                "ORDER BY embedding <=> %s::vector LIMIT %s;",
                (lit, game, lit, int(limit)),
            )
            rows = cur.fetchall()
    except Exception:
        return []
    finally:
        conn.close()
    return [
        {"name": r[0], "set": r[1], "number": r[2], "score": float(r[3])}
        for r in rows
    ]


# ----------------------------------------------------------------------------
# Card-source fetching (best-effort; falls back to a synthetic set)
# ----------------------------------------------------------------------------
_SYNTHETIC = {
    "pokemon": [
        {"id": "base1-4", "name": "Charizard", "set": "Base", "number": "4", "types": "Fire"},
        {"id": "base1-2", "name": "Blastoise", "set": "Base", "number": "2", "types": "Water"},
        {"id": "base1-15", "name": "Venusaur", "set": "Base", "number": "15", "types": "Grass"},
        {"id": "base1-58", "name": "Pikachu", "set": "Base", "number": "58", "types": "Lightning"},
        {"id": "base1-16", "name": "Zapdos", "set": "Base", "number": "16", "types": "Lightning"},
        {"id": "base1-10", "name": "Mewtwo", "set": "Base", "number": "10", "types": "Psychic"},
    ]
}


def _fetch_cards(game: str) -> list[dict[str, Any]]:
    """Fetch official cards; fall back to a small synthetic set on any failure."""
    if game == "pokemon":
        try:
            headers = {}
            if POKEMON_API_KEY:
                headers["X-Api-Key"] = POKEMON_API_KEY
            resp = requests.get(
                POKEMON_API,
                params={
                    "pageSize": 60,
                    "select": "id,name,set,number,rarity,types",
                    # Oldest sets first -> the iconic Base set (Charizard et al.),
                    # which makes this extra channel demonstrably useful.
                    "orderBy": "set.releaseDate,number",
                },
                headers=headers,
                timeout=20,
            )
            resp.raise_for_status()
            data = resp.json().get("data", [])
            cards: list[dict[str, Any]] = []
            for c in data:
                set_obj = c.get("set") or {}
                cards.append(
                    {
                        "id": c.get("id", ""),
                        "name": c.get("name", ""),
                        "set": set_obj.get("name", ""),
                        "number": c.get("number", ""),
                        "types": " ".join(c.get("types", []) or []),
                    }
                )
            if cards:
                return cards
        except Exception:
            pass
    return list(_SYNTHETIC.get(game, _SYNTHETIC["pokemon"]))


def _reindex(game: str) -> int:
    cards = _fetch_cards(game)
    if not cards or not ensure_schema():
        return 0
    conn = _connect()
    if conn is None:
        return 0
    n = 0
    try:
        with conn, conn.cursor() as cur:
            for c in cards:
                doc = f"{c['name']} {c['number']} {c['set']} {c['types']}".strip()
                cur.execute(
                    f"INSERT INTO {TABLE} "
                    "(id, game, card_id, name, set_name, number, embedding) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s::vector) "
                    "ON CONFLICT (id) DO UPDATE SET "
                    "embedding=EXCLUDED.embedding, name=EXCLUDED.name, "
                    "set_name=EXCLUDED.set_name, number=EXCLUDED.number;",
                    (
                        f"{game}:{c['id']}",
                        game,
                        c["id"],
                        c["name"],
                        c["set"],
                        c["number"],
                        _vec_literal(text_embed(doc)),
                    ),
                )
                n += 1
    except Exception:
        return 0
    finally:
        conn.close()
    return n


# ----------------------------------------------------------------------------
# Routes
# ----------------------------------------------------------------------------
@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/reindex")
async def reindex(request: Request, game: str | None = None) -> dict[str, int]:
    g = game
    if g is None:
        try:
            body = await request.json()
            if isinstance(body, dict):
                g = body.get("game")
        except Exception:
            g = None
    g = (g or "pokemon").strip() or "pokemon"
    return {"indexed": _reindex(g)}


@app.get("/search")
def search(q: str = "", game: str = "pokemon", limit: int = 5) -> dict[str, Any]:
    return {"results": _search(q, game, limit)}


@app.post("/ocr_search")
async def ocr_search(
    image: UploadFile = File(...),
    game: str = Form("pokemon"),
    limit: int = Form(5),
) -> dict[str, Any]:
    ocr_text = ""
    try:
        import pytesseract
        from PIL import Image

        raw = await image.read()
        img = Image.open(io.BytesIO(raw))
        ocr_text = pytesseract.image_to_string(img) or ""
        ocr_text = ocr_text.strip()
    except Exception:
        # Bad image / OCR failure must never 500.
        return {"ocr_text": "", "results": []}

    if not ocr_text:
        return {"ocr_text": "", "results": []}
    return {"ocr_text": ocr_text, "results": _search(ocr_text, game, limit)}
