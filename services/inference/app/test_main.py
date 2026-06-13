from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"

def test_predict_stub_shape():
    files = {"image": ("card.jpg", b"fakebytes", "image/jpeg")}
    r = client.post("/predict", files=files)
    assert r.status_code == 200
    body = r.json()
    for key in ("name", "type", "set", "rarity", "card_number"):
        assert key in body and "value" in body[key] and "conf" in body[key]
    assert "model_version" in body
