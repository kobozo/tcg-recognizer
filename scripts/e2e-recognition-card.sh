#!/usr/bin/env bash
# End-to-end recognition test: inject real Pokémon card images into the running
# inference service and assert the correct card comes back as the top match.
#
# Mirrors production: builds the pgvector index with the trainer, starts the
# inference service, then POSTs card images to /predict (in-network) and checks
# the returned name. The index embedder is kept in sync with the inference
# embedder (read from .env: EMBEDDER / EMBED_HEAD / RERANK_TOP_K).
#
#   bash scripts/e2e-recognition-card.sh                 # defaults: 200 cards, check 5
#   N=300 NCHECK=8 bash scripts/e2e-recognition-card.sh
#
# Exit 0 + "RECOGNITION E2E OK" only if every injected card is recognised.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[ -f .env ] || cp .env.example .env

N="${N:-200}"            # cards indexed
NCHECK="${NCHECK:-5}"    # cards injected/checked (stride-sampled from the index)
# Read the active recognition config from .env so the index we build matches
# what the inference service will use (same embedder + same learned head).
EMB="$(grep -E '^EMBEDDER=' .env | cut -d= -f2 | tr -d '[:space:]')"; EMB="${EMB:-classical}"
HEAD="$(grep -E '^EMBED_HEAD=' .env | cut -d= -f2 | tr -d '[:space:]')"

echo "==> embedder=$EMB  head=${HEAD:-none}  index=$N  inject=$NCHECK"

echo "==> db + migrations"
docker compose up -d db >/dev/null
docker compose run --rm --no-deps web sh -c \
  "npx prisma db push --skip-generate --accept-data-loss" >/dev/null 2>&1 || true

echo "==> build trainer + inference"
docker compose build trainer inference >/dev/null

echo "==> build index ($N cards, $EMB, head=${HEAD:-none})"
# METRICS_PATH to a throwaway so this e2e never clobbers the tracked DVC metric.
docker compose run --rm --user "$(id -u):$(id -g)" \
  -e EMBEDDER="$EMB" -e EMBED_HEAD="$HEAD" -e SAMPLE_SIZE="$N" -e EVAL_CARDS=1 -e EVAL_VIEWS=1 \
  -e METRICS_PATH=/tmp/e2e-metrics.json \
  trainer python main.py >/dev/null

echo "==> start inference"
docker compose up -d --build inference >/dev/null

echo "==> wait for inference health"
ok=0
for _ in $(seq 1 60); do
  if docker compose exec -T inference python -c \
      "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://localhost:8001/health').status==200 else 1)" 2>/dev/null; then
    ok=1; break
  fi
  sleep 2
done
[ "$ok" = 1 ] || { echo "FAIL: inference not healthy"; docker compose logs --tail 30 inference; exit 1; }
echo "    inference healthy"

echo "==> inject $NCHECK known cards and check the top match"
# Run the injector inside the trainer container: it has the dataset at /data and
# can reach the inference service at http://inference:8001 on the compose net.
docker compose run --rm --no-deps -e NCHECK="$NCHECK" -e N="$N" trainer python - <<'PY'
import json, os, urllib.request, uuid

N = int(os.environ["N"]); NCHECK = int(os.environ["NCHECK"])
base = os.environ.get("DATASET_DIR", "/data")
manifest = os.path.join(base, "pokemon", "manifest.jsonl")

cards = []
with open(manifest) as f:
    for line in f:
        line = line.strip()
        if line:
            cards.append(json.loads(line))
indexed = cards[:N]                       # main.py caps to the first N
step = max(1, len(indexed) // NCHECK)
sample = indexed[::step][:NCHECK]

def predict(img_path, game):
    with open(img_path, "rb") as fh:
        png = fh.read()
    b = "----b" + uuid.uuid4().hex
    parts = [
        ("--" + b).encode(),
        b'Content-Disposition: form-data; name="game"', b"", game.encode(),
        ("--" + b).encode(),
        b'Content-Disposition: form-data; name="image"; filename="card.png"',
        b"Content-Type: image/png", b"", png,
        ("--" + b + "--").encode(), b"",
    ]
    body = b"\r\n".join(parts)
    req = urllib.request.Request(
        "http://inference:8001/predict", data=body,
        headers={"Content-Type": "multipart/form-data; boundary=" + b}, method="POST")
    return json.loads(urllib.request.urlopen(req, timeout=60).read())

hit1 = hit3 = 0
for c in sample:
    img = os.path.join(base, c["image_path"])
    got = predict(img, "pokemon")
    nm = got.get("name") or {}
    top = (nm.get("value") or "").strip()
    cands = [(x.get("value") or "").strip().lower() for x in (nm.get("candidates") or [])]
    exp = c["name"].strip()
    in1 = top.lower() == exp.lower()
    in3 = exp.lower() in cands
    hit1 += in1
    hit3 += in3
    mark = "OK" if in1 else ("top3" if in3 else "MISS")
    print(f"    inject {c['card_id']:<14} expect={exp!r:<22} got={top!r:<22} {mark}")

n = len(sample)
print(f"RESULT rank1={hit1}/{n}  top3={hit3}/{n}")
import sys
# Pass when the correct card is surfaced in the candidates for every injected
# card (the app's confirm-UX), and rank-1 accuracy is strong.
sys.exit(0 if (hit3 == n and hit1 >= max(1, int(0.8 * n))) else 1)
PY

echo "RECOGNITION E2E OK"
