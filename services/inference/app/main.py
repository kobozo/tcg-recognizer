from fastapi import FastAPI, UploadFile, File

app = FastAPI(title="TCG Inference (stub)")
MODEL_VERSION = "stub-0"

@app.get("/health")
def health():
    return {"status": "ok", "model_version": MODEL_VERSION}

@app.get("/model")
def model():
    return {"version": MODEL_VERSION, "metrics": {}, "is_current": True}

@app.post("/predict")
async def predict(image: UploadFile = File(...)):
    await image.read()
    def field(value, conf):
        return {"value": value, "conf": conf}
    # Stubbed prediction until Phase 3 swaps in the real model.
    return {
        "name": {"candidates": [field("Charizard", 0.93)], **field("Charizard", 0.93)},
        "type": field("Fire", 0.97),
        "set": field("Base", 0.74),
        "rarity": field("Rare Holo", 0.81),
        "card_number": field("4/102", 0.66),
        "model_version": MODEL_VERSION,
    }
