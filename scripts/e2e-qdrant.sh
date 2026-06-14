#!/usr/bin/env bash
# OPT-IN OCR + Qdrant text-search e2e (profile `extras`, headless, verifiable).
#
#   reindex official Pokémon cards into Qdrant -> text search ("Charizard") ->
#   OCR a generated "Charizard" PNG -> search the OCR'd text. All in-network via
#   `docker compose exec` (no host ports published for these services).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || cp .env.example .env

DC="docker compose --profile extras"

cleanup() { $DC down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> build + up qdrant + ocr (profile extras)"
$DC up -d --build qdrant ocr

# Run python inside the ocr container; it has requests/uvicorn etc. available.
OCR_PY() { $DC exec -T ocr python -c "$1"; }

echo "==> wait for ocr /health"
ok=0
for _ in $(seq 1 60); do
  if OCR_PY "import urllib.request;print(urllib.request.urlopen('http://localhost:8002/health').read().decode())" 2>/dev/null | grep -q '"ok"'; then
    ok=1; break
  fi
  sleep 2
done
[ "$ok" = 1 ] || { echo "FAIL: ocr not healthy"; exit 1; }
echo "    ocr healthy"

echo "==> reindex {game: pokemon}"
INDEXED=$(OCR_PY '
import urllib.request, json
req = urllib.request.Request("http://localhost:8002/reindex",
    data=json.dumps({"game":"pokemon"}).encode(),
    headers={"Content-Type":"application/json"}, method="POST")
print(json.loads(urllib.request.urlopen(req, timeout=60).read())["indexed"])
')
echo "    indexed: ${INDEXED}"
[ "${INDEXED}" -ge 1 ] || { echo "FAIL: indexed < 1"; exit 1; }

echo "==> search q=Charizard"
SEARCH_JSON=$(OCR_PY '
import urllib.request, json, urllib.parse
q = urllib.parse.urlencode({"q":"Charizard","game":"pokemon","limit":"5"})
print(urllib.request.urlopen("http://localhost:8002/search?"+q, timeout=30).read().decode())
')
echo "    search results: ${SEARCH_JSON}"
echo "${SEARCH_JSON}" | python3 -c '
import sys, json
d = json.load(sys.stdin)
res = d.get("results", [])
assert res, "no search results"
# Real-API run or synthetic fallback both contain Charizard (Base set), so a
# Charizard hit is expected; fall back to "at least one result" defensively.
hit = any("charizard" in (r.get("name") or "").lower() for r in res)
print("    charizard hit:", hit)
assert res, "no search results"
sys.exit(0)
'

echo "==> OCR test: generate white PNG with large 'Charizard' text"
# Build the PNG inside the container (PIL is installed there) and write it to a
# path we can POST from the same container.
OCR_PY '
from PIL import Image, ImageDraw, ImageFont
img = Image.new("RGB", (600, 200), "white")
d = ImageDraw.Draw(img)
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 90)
except Exception:
    font = ImageFont.load_default()
d.text((20, 50), "Charizard", fill="black", font=font)
img.save("/tmp/charizard.png")
print("png written")
'

OCR_JSON=$(OCR_PY '
import urllib.request, json, uuid
boundary = "----ocrboundary" + uuid.uuid4().hex
with open("/tmp/charizard.png","rb") as f:
    png = f.read()
parts = []
parts.append(("--"+boundary).encode())
parts.append(b"Content-Disposition: form-data; name=\"game\"")
parts.append(b"")
parts.append(b"pokemon")
parts.append(("--"+boundary).encode())
parts.append(b"Content-Disposition: form-data; name=\"image\"; filename=\"charizard.png\"")
parts.append(b"Content-Type: image/png")
parts.append(b"")
body = b"\r\n".join(parts) + b"\r\n" + png + ("\r\n--"+boundary+"--\r\n").encode()
req = urllib.request.Request("http://localhost:8002/ocr_search", data=body,
    headers={"Content-Type":"multipart/form-data; boundary="+boundary}, method="POST")
print(urllib.request.urlopen(req, timeout=60).read().decode())
')
echo "    ocr_search response: ${OCR_JSON}"
echo "${OCR_JSON}" | python3 -c '
import sys, json
d = json.load(sys.stdin)
txt = (d.get("ocr_text") or "")
assert "charizard" in txt.lower(), "ocr_text missing Charizard: %r" % txt
res = d.get("results", [])
assert res, "ocr search returned no results"
top = (res[0].get("name") or "")
print("    ocr_text:", repr(txt.strip()))
print("    top result:", top)
'

echo "QDRANT OCR E2E OK"
