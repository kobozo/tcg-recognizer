#!/usr/bin/env bash
# End-to-end test for VLM-assisted recognition (SP6).
#
# Injects a real card image into vlmDisambiguate() with a 3-way candidate
# shortlist and asserts the VLM picks the correct card — proving the
# vision-router -> local Ollama vision model (llava) path works end to end.
#
#   bash scripts/e2e-vlm.sh
#
# Prints "VLM E2E OK" and exits 0 on success.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[ -f .env ] || cp .env.example .env
VMODEL="$(grep -E '^OLLAMA_VISION_MODEL=' .env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]' || true)"; VMODEL="${VMODEL:-llava:7b}"

# A real, iconic card the VLM should distinguish (Blastoise) + decoys.
CARD_IMG="pokemon/images/pl1-2.png"      # Blastoise (Platinum)
EXPECT="Blastoise"
CANDS='["Charizard","Blastoise","Venusaur"]'

echo "==> start ollama + pull vision model $VMODEL"
docker compose --profile llm up -d ollama >/dev/null
docker compose exec -T ollama ollama pull "$VMODEL" >/dev/null

HARNESS="apps/web/.vlm-e2e.ts"
cat > "$HARNESS" <<TS
import { readFileSync } from "node:fs";
import { vlmDisambiguate } from "@/lib/vlm";

(async () => {
  const bytes = readFileSync("/data/${CARD_IMG}");
  const res = await vlmDisambiguate(bytes, ${CANDS});
  console.log("VLM RESULT:", JSON.stringify(res));
  const pick = (res && res.pick ? res.pick : "").trim().toLowerCase();
  process.exit(pick === "${EXPECT}".toLowerCase() ? 0 : 1);
})().catch((e) => { console.error("ERR", e?.message || e); process.exit(2); });
TS
trap 'rm -f "$HARNESS"' EXIT

echo "==> run vlmDisambiguate() -> $VMODEL (in-network) on $EXPECT card"
docker compose run --rm --no-deps \
  -e VLM_ASSIST=1 -e VLM_PROVIDER=ollama \
  -e OLLAMA_URL=http://ollama:11434 -e OLLAMA_VISION_MODEL="$VMODEL" \
  -v "$ROOT/ml/datasets:/data:ro" \
  -w /app web npx tsx .vlm-e2e.ts

echo "VLM E2E OK"
