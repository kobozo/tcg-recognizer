from fastapi import FastAPI, UploadFile, File, Form

app = FastAPI(title="TCG Inference (stub)")
MODEL_VERSION = "stub-0"


def field(value, conf):
    return {"value": value, "conf": conf}


# Per-game placeholder predictions until Phase 3 swaps in the real model.
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


@app.get("/health")
def health():
    return {"status": "ok", "model_version": MODEL_VERSION}


@app.get("/model")
def model():
    return {"version": MODEL_VERSION, "metrics": {}, "is_current": True}


@app.post("/predict")
async def predict(image: UploadFile = File(...), game: str = Form("pokemon")):
    await image.read()
    stub = STUBS.get(game, STUBS["pokemon"])
    return {**stub, "game": game, "model_version": MODEL_VERSION}
