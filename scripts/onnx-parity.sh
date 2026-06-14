#!/usr/bin/env bash
#
# DINOv2 (EMBEDDER=onnx) parity check.
#
# Proves the Python server `_embed_onnx()` and the browser/Node `embedRgbaOnnx()`
# produce a matching learned embedding for the SAME real card image, so an
# on-device DINOv2 vector lines up with the server's pgvector index.
#
# Strategy (robust + decode-agnostic):
#   1. Download ONE real card image (Pokemon TCG API, images.small).
#   2. Decode it ONCE with PIL and emit a fixed-size raw RGBA buffer
#      (RAW_W x RAW_H). Both sides then consume that IDENTICAL RGBA buffer, so
#      any cosine gap is due to the model/preprocessing, not JPEG decoding.
#   3. Python side runs inside the `tcg-inference` image with EMBEDDER=onnx and
#      embeds the RGBA buffer (downloads the DINOv2 ONNX model to /models once).
#   4. Node side runs `embedRgbaOnnx(rgba, W, H)` via tsx from apps/web.
#   5. Print cosine similarity; assert >= THRESHOLD (0.90 — learned features are
#      robust to small preprocessing diffs).
#
# Network is required (model + image download). May build the inference image.
#
# Usage:  bash scripts/onnx-parity.sh
set -euo pipefail

THRESHOLD="${THRESHOLD:-0.90}"
RAW_W="${RAW_W:-245}"
RAW_H="${RAW_H:-342}"
CARD_IMG_URL="${CARD_IMG_URL:-https://images.pokemontcg.io/base1/4.png}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

WORK="$(mktemp -d)"
MODELS="$ROOT/.onnx-models-cache"
mkdir -p "$MODELS"
PARITY_TMP="$ROOT/scripts/.onnx_parity_tmp"
cleanup() { rm -rf "$WORK" "$PARITY_TMP"; }
trap cleanup EXIT

echo "[onnx-parity] repo root: $ROOT"
echo "[onnx-parity] card image: $CARD_IMG_URL"
echo "[onnx-parity] raw RGBA size: ${RAW_W}x${RAW_H}"
echo "[onnx-parity] models cache: $MODELS"

# --- 1. Download the card image. ---
echo "[onnx-parity] downloading card image..."
curl -fsSL "$CARD_IMG_URL" -o "$WORK/card.png"

# --- 2. Ensure the inference Docker image exists. ---
if ! docker image inspect tcg-inference >/dev/null 2>&1; then
  echo "[onnx-parity] building tcg-inference image..."
  docker build -t tcg-inference "$ROOT/services/inference" >/dev/null
else
  echo "[onnx-parity] reusing existing tcg-inference image."
fi

# --- 3. Decode once to a fixed-size raw RGBA buffer (inside Docker, via PIL). ---
cat > "$WORK/make_rgba.py" <<PYEOF
import sys
from PIL import Image

W, H = int(sys.argv[2]), int(sys.argv[3])
img = Image.open(sys.argv[1]).convert("RGBA").resize((W, H), Image.BICUBIC)
with open(sys.argv[4], "wb") as f:
    f.write(img.tobytes())  # raw RGBA, row-major
PYEOF

echo "[onnx-parity] decoding to raw RGBA..."
docker run --rm -v "$WORK:/work" -w /work tcg-inference \
  python /work/make_rgba.py /work/card.png "$RAW_W" "$RAW_H" /work/card.rgba

# --- 4. Python DINOv2 embedding (EMBEDDER=onnx). 512 floats, one per line. ---
cat > "$WORK/py_embed.py" <<PYEOF
import sys
import numpy as np
from PIL import Image
from app.embedding import embed

W, H = int(sys.argv[2]), int(sys.argv[3])
raw = open(sys.argv[1], "rb").read()
arr = np.frombuffer(raw, dtype=np.uint8).reshape(H, W, 4)
img = Image.fromarray(arr[:, :, :3], mode="RGB")
vec = embed(img)
assert len(vec) == 512, f"len={len(vec)}"
sys.stdout.write("\n".join(repr(float(v)) for v in vec) + "\n")
PYEOF

echo "[onnx-parity] computing Python DINOv2 embedding (downloads model once)..."
docker run --rm \
  -v "$ROOT/services/inference/app:/app/app:ro" \
  -v "$WORK:/work" \
  -v "$MODELS:/models" \
  -w /app \
  -e PYTHONPATH=/app \
  -e EMBEDDER=onnx \
  -e MODEL_DIR=/models \
  tcg-inference \
  python /work/py_embed.py /work/card.rgba "$RAW_W" "$RAW_H" > "$WORK/py.txt"

# --- 5. Node/TS DINOv2 embedding via tsx. 512 floats, one per line. ---
mkdir -p "$PARITY_TMP"
cat > "$PARITY_TMP/ts_embed.ts" <<'TSEOF'
import { readFileSync } from "node:fs";
import { embedRgbaOnnx } from "../../apps/web/lib/onnxEmbedding";

const path = process.argv[2];
const W = parseInt(process.argv[3], 10);
const H = parseInt(process.argv[4], 10);
const buf = readFileSync(path);
const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

(async () => {
  const vec = await embedRgbaOnnx(data, W, H);
  if (vec.length !== 512) {
    process.stderr.write(`len=${vec.length}\n`);
    process.exit(2);
  }
  process.stdout.write(vec.map((v) => String(v)).join("\n") + "\n");
})();
TSEOF

echo "[onnx-parity] computing Node/TS DINOv2 embedding via tsx..."
( cd "$ROOT/apps/web" && npx --yes tsx "$PARITY_TMP/ts_embed.ts" "$WORK/card.rgba" "$RAW_W" "$RAW_H" ) > "$WORK/ts.txt"

# --- 6. Cosine similarity + assertion. ---
echo "[onnx-parity] comparing vectors..."
COS="$(paste "$WORK/py.txt" "$WORK/ts.txt" | awk '
  { a=$1; b=$2; dot+=a*b; na+=a*a; nb+=b*b; n++ }
  END {
    if (n != 512) { printf "ERR_LEN:%d\n", n; exit }
    if (na <= 0 || nb <= 0) { print "ERR_ZERO"; exit }
    printf "%.10f\n", dot/(sqrt(na)*sqrt(nb))
  }')"

echo "[onnx-parity] vector length: $(wc -l < "$WORK/py.txt") (py) / $(wc -l < "$WORK/ts.txt") (ts)"
echo "[onnx-parity] cosine similarity = $COS"

# Guard the awk error sentinels (ERR_LEN / ERR_ZERO) explicitly: a non-numeric
# COS must always FAIL, and the comparison is forced to numeric context (+0).
case "$COS" in
  ERR_*|"")
    echo "[onnx-parity] FAIL: could not compute cosine ($COS)"
    exit 1
    ;;
esac
awk -v c="$COS" -v t="$THRESHOLD" 'BEGIN { exit !((c + 0) >= (t + 0)) }' || {
  echo "[onnx-parity] FAIL: cosine $COS < $THRESHOLD"
  exit 1
}

echo "[onnx-parity] PASS: cosine $COS >= $THRESHOLD"
