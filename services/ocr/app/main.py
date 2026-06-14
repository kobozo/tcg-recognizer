"""OCR + Qdrant text-search subsystem (opt-in `extras` channel).

OCRs cards into text, vectorizes that text with a deterministic, model-free
character/token n-gram hashing embedder, and stores/searches it in Qdrant. It
is an *extra* candidate channel for the recognition flywheel, CPU-only, and is
gated behind the Docker Compose `extras` profile so the default stack is
untouched.

Every Qdrant / network call is defensive: the service stays up (returning empty
results) even if Qdrant is briefly unavailable or an image is malformed.
"""
from __future__ import annotations

import io
import os
import re
import uuid
from typing import Any

import numpy as np
import requests
from fastapi import FastAPI, File, Form, Request, UploadFile

# Qdrant client + models are imported defensively so the module still imports
# (e.g. for `import app.main`) even if the package layout shifts.
try:
    from qdrant_client import QdrantClient
    from qdrant_client.http import models as qmodels
except Exception:  # pragma: no cover - defensive import
    QdrantClient = None  # type: ignore
    qmodels = None  # type: ignore

# ----------------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------------
QDRANT_URL = os.environ.get("QDRANT_URL", "http://qdrant:6333")
COLLECTION = "cards_text"
VECTOR_SIZE = 256
POKEMON_API = "https://api.pokemontcg.io/v2/cards"
POKEMON_API_KEY = os.environ.get("POKEMON_TCG_API_KEY", "").strip()

# Stable namespace so the same (game, card_id) always maps to the same point id;
# re-running /reindex upserts in place rather than duplicating.
_NS = uuid.UUID("6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8")

app = FastAPI(title="tcg-ocr", version="1.0.0")

_client: "QdrantClient | None" = None


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
# Qdrant helpers (all defensive)
# ----------------------------------------------------------------------------
def get_client() -> "QdrantClient | None":
    global _client
    if QdrantClient is None:
        return None
    if _client is None:
        try:
            _client = QdrantClient(url=QDRANT_URL, timeout=10.0)
        except Exception:
            _client = None
    return _client


def ensure_collection() -> bool:
    """Create the `cards_text` collection on first use. Returns success."""
    client = get_client()
    if client is None or qmodels is None:
        return False
    try:
        client.get_collection(COLLECTION)
        return True
    except Exception:
        pass
    try:
        client.create_collection(
            collection_name=COLLECTION,
            vectors_config=qmodels.VectorParams(
                size=VECTOR_SIZE, distance=qmodels.Distance.COSINE
            ),
        )
        return True
    except Exception:
        # Possibly a race where another worker created it; treat as present if
        # it now exists.
        try:
            client.get_collection(COLLECTION)
            return True
        except Exception:
            return False


def point_id(game: str, card_id: str) -> str:
    return str(uuid.uuid5(_NS, f"{game}:{card_id}"))


def _search(query: str, game: str, limit: int) -> list[dict[str, Any]]:
    client = get_client()
    if client is None or qmodels is None:
        return []
    if not ensure_collection():
        return []
    try:
        flt = qmodels.Filter(
            must=[
                qmodels.FieldCondition(
                    key="game", match=qmodels.MatchValue(value=game)
                )
            ]
        )
        response = client.query_points(
            collection_name=COLLECTION,
            query=text_embed(query),
            query_filter=flt,
            limit=limit,
            with_payload=True,
        )
        hits = response.points
    except Exception:
        return []
    out: list[dict[str, Any]] = []
    for h in hits:
        p = h.payload or {}
        out.append(
            {
                "name": p.get("name"),
                "set": p.get("set"),
                "number": p.get("number"),
                "score": float(h.score),
            }
        )
    return out


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
    client = get_client()
    if client is None or qmodels is None:
        return 0
    if not ensure_collection():
        return 0

    points = []
    for c in cards:
        doc = f"{c['name']} {c['number']} {c['set']} {c['types']}".strip()
        points.append(
            qmodels.PointStruct(
                id=point_id(game, c["id"]),
                vector=text_embed(doc),
                payload={
                    "game": game,
                    "card_id": c["id"],
                    "name": c["name"],
                    "set": c["set"],
                    "number": c["number"],
                },
            )
        )
    if not points:
        return 0
    try:
        client.upsert(collection_name=COLLECTION, points=points, wait=True)
    except Exception:
        return 0
    return len(points)


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
    n = _reindex(g)
    return {"indexed": n}


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
