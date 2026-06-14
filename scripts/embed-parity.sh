#!/usr/bin/env bash
#
# Parity check: prove the Python server `embed()` and the TypeScript browser
# `embedRgba()` produce the SAME 512-d descriptor for identical RGBA input.
#
# Both sides build the EXACT same deterministic RGBA pattern (size SIZE x SIZE):
#   r = (x*7 + y*3) % 256, g = (x*5) % 256, b = (y*11) % 256, a = 255
# and feed those raw RGBA bytes into their respective embedder. Both perform the
# same nearest-neighbor resize SIZE -> 224 internally. We then print the cosine
# similarity between the two vectors and require >= 0.999.
#
# Python runs inside the `tcg-inference` Docker image (built if missing).
# Node/TS runs via `npx tsx` from apps/web (tsx is a dev dependency there).
#
# Usage:  bash scripts/embed-parity.sh
set -euo pipefail

SIZE="${SIZE:-96}"
THRESHOLD="0.999"

# Resolve repo root from this script's location (works from any CWD).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

WORK="$(mktemp -d)"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

echo "[parity] repo root: $ROOT"
echo "[parity] test pattern size: ${SIZE}x${SIZE}"

# --- 1. Ensure the inference Docker image exists. ---
if ! docker image inspect tcg-inference >/dev/null 2>&1; then
  echo "[parity] building tcg-inference image..."
  docker build -t tcg-inference "$ROOT/services/inference" >/dev/null
else
  echo "[parity] reusing existing tcg-inference image."
fi

# --- 2. Python embedding (inside Docker). Writes 512 floats, one per line. ---
cat > "$WORK/py_embed.py" <<PYEOF
import sys
import numpy as np
from PIL import Image
from app.embedding import embed

SIZE = int(sys.argv[1])

# Build the SAME deterministic RGBA pattern as the Node side.
rgba = np.zeros((SIZE, SIZE, 4), dtype=np.uint8)
for y in range(SIZE):
    for x in range(SIZE):
        rgba[y, x, 0] = (x * 7 + y * 3) % 256
        rgba[y, x, 1] = (x * 5) % 256
        rgba[y, x, 2] = (y * 11) % 256
        rgba[y, x, 3] = 255

# embed() takes a PIL image; drop alpha (RGB), matching embedRgba which also
# drops alpha. Both then nearest-resize SIZE -> 224 identically.
img = Image.fromarray(rgba[:, :, :3], mode="RGB")
vec = embed(img)
sys.stdout.write("\n".join(repr(float(v)) for v in vec) + "\n")
PYEOF

echo "[parity] computing Python embedding in Docker..."
# Mount the CURRENT app/ over the image's baked /app/app so we test live code,
# and run from /app where the `app` package is importable.
docker run --rm \
  -v "$ROOT/services/inference/app:/app/app:ro" \
  -v "$WORK:/work" \
  -w /app \
  -e PYTHONPATH=/app \
  tcg-inference \
  python /work/py_embed.py "$SIZE" > "$WORK/py.txt"

# --- 3. Node/TS embedding via tsx. Writes 512 floats, one per line. ---
cat > "$WORK/ts_embed.ts" <<'TSEOF'
import { embedRgba } from "../../apps/web/lib/clientEmbedding";

const SIZE = parseInt(process.argv[2], 10);
const data = new Uint8ClampedArray(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    data[i + 0] = (x * 7 + y * 3) % 256;
    data[i + 1] = (x * 5) % 256;
    data[i + 2] = (y * 11) % 256;
    data[i + 3] = 255;
  }
}
const vec = embedRgba(data, SIZE, SIZE);
process.stdout.write(vec.map((v) => String(v)).join("\n") + "\n");
TSEOF

# Place the TS entry where its relative import resolves to the repo's lib file,
# and run it with tsx from apps/web (which has tsx + typescript installed).
mkdir -p "$ROOT/scripts/.parity_tmp"
cp "$WORK/ts_embed.ts" "$ROOT/scripts/.parity_tmp/ts_embed.ts"
cleanup() { rm -rf "$WORK" "$ROOT/scripts/.parity_tmp"; }

echo "[parity] computing Node/TS embedding via tsx..."
( cd "$ROOT/apps/web" && npx --yes tsx "$ROOT/scripts/.parity_tmp/ts_embed.ts" "$SIZE" ) > "$WORK/ts.txt"

# --- 4. Cosine similarity + assertion (done in pure bash via awk). ---
echo "[parity] comparing vectors..."
COS="$(paste "$WORK/py.txt" "$WORK/ts.txt" | awk '
  { a=$1; b=$2; dot+=a*b; na+=a*a; nb+=b*b; n++ }
  END {
    if (n != 512) { printf "ERR_LEN:%d\n", n; exit }
    if (na <= 0 || nb <= 0) { print "ERR_ZERO"; exit }
    printf "%.10f\n", dot/(sqrt(na)*sqrt(nb))
  }')"

echo "[parity] vector length: $(wc -l < "$WORK/py.txt") (py) / $(wc -l < "$WORK/ts.txt") (ts)"
echo "[parity] cosine similarity = $COS"

awk -v c="$COS" -v t="$THRESHOLD" 'BEGIN { exit !(c >= t) }' || {
  echo "[parity] FAIL: cosine $COS < $THRESHOLD"
  exit 1
}

echo "[parity] PASS: cosine $COS >= $THRESHOLD"
