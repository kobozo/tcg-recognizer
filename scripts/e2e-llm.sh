#!/usr/bin/env bash
# End-to-end test for the local LLM + provider router (SP5).
#
# Starts the opt-in Ollama service, pulls the configured model, then drives a
# real round-trip THROUGH the app's router (chatRouted) against the live Ollama
# server — proving local LLM serving + the routing layer work end to end.
#
#   bash scripts/e2e-llm.sh
#
# Prints "LLM ROUTER E2E OK" and exits 0 on success.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[ -f .env ] || cp .env.example .env
MODEL="$(grep -E '^OLLAMA_MODEL=' .env | cut -d= -f2 | tr -d '[:space:]')"; MODEL="${MODEL:-llama3.2:3b}"

echo "==> start ollama (profile llm) + pull $MODEL"
docker compose --profile llm up -d ollama >/dev/null
docker compose exec -T ollama ollama pull "$MODEL" >/dev/null

echo "==> wait for ollama API"
ok=0
for _ in $(seq 1 30); do
  if docker compose exec -T ollama ollama list >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
[ "$ok" = 1 ] || { echo "FAIL: ollama not ready"; exit 1; }

# Harness lives under apps/web so the "@/" path alias resolves via tsconfig.
HARNESS="apps/web/.llm-e2e.ts"
cat > "$HARNESS" <<'TS'
import { chatRouted } from "@/lib/llm/router";

(async () => {
  const ans = await chatRouted(
    [{ role: "user", content: "Reply with exactly one word: PONG" }],
    { maxTokens: 20, temperature: 0 },
  );
  console.log("ANSWER:", JSON.stringify(ans));
  process.exit(ans && ans.trim().length > 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERR", e?.message || e);
  process.exit(2);
});
TS
trap 'rm -f "$HARNESS"' EXIT

echo "==> route a prompt through chatRouted() -> ollama (in-network)"
docker compose run --rm --no-deps \
  -e LLM_PROVIDER=ollama -e OLLAMA_URL=http://ollama:11434 -e OLLAMA_MODEL="$MODEL" \
  -w /app web npx tsx .llm-e2e.ts

echo "LLM ROUTER E2E OK"
