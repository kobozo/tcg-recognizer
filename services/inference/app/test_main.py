"""Tests that run WITHOUT a database (no DATABASE_URL).

With no DB configured, /predict exercises the real deskew + embed pipeline on a
genuine image and then falls back to the per-game stub for the lookup result.
"""
import io
import os

from fastapi.testclient import TestClient
from PIL import Image

# Ensure no DB is configured so we exercise the stub fallback path.
os.environ.pop("DATABASE_URL", None)
# Force the default (classical) embedder so CI never touches the network: the
# onnx backend would otherwise try to download the DINOv2 model on first embed.
os.environ.pop("EMBEDDER", None)

from app.main import app  # noqa: E402

client = TestClient(app)


def _png_bytes(color=(200, 30, 30), size=(360, 504)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert "model_version" in r.json()
    # Default backend must be classical so CI does no model download.
    assert r.json().get("embedder") == "classical"


def test_predict_stub_shape():
    files = {"image": ("card.png", _png_bytes(), "image/png")}
    r = client.post("/predict", files=files)
    assert r.status_code == 200
    body = r.json()
    for key in ("name", "type", "set", "rarity", "card_number"):
        assert key in body
        assert "value" in body[key]
        assert "conf" in body[key]
    assert "model_version" in body
    assert body["game"] == "pokemon"


def test_predict_invalid_image_still_ok():
    files = {"image": ("card.jpg", b"notanimage", "image/jpeg")}
    r = client.post("/predict", files=files, data={"game": "magic"})
    assert r.status_code == 200
    body = r.json()
    assert body["game"] == "magic"
    assert "name" in body and "value" in body["name"]


def test_embed_is_512_normalized():
    from app.embedding import embed
    import math

    vec = embed(Image.new("RGB", (224, 224), (10, 120, 240)))
    assert len(vec) == 512
    assert abs(math.sqrt(sum(x * x for x in vec)) - 1.0) < 1e-5


def test_predict_accepts_precomputed_embedding():
    """A valid precomputed embedding is accepted (no image needed); without a
    DB it falls back to the stub but must not 500."""
    import json

    vec = [0.0] * 512
    vec[0] = 1.0
    r = client.post(
        "/predict",
        data={"game": "pokemon", "embedding": json.dumps(vec)},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["game"] == "pokemon"
    assert "name" in body and "value" in body["name"]


def test_predict_invalid_embedding_falls_back_to_image():
    """An invalid embedding (wrong length) is ignored; the image path runs."""
    import json

    files = {"image": ("card.png", _png_bytes(), "image/png")}
    r = client.post(
        "/predict",
        files=files,
        data={"game": "magic", "embedding": json.dumps([0.1, 0.2, 0.3])},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["game"] == "magic"
    assert "name" in body
