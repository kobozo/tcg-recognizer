#!/usr/bin/env bash
# Sub-project 7 — LLM-as-judge GROUNDEDNESS eval for the collection assistant.
#
# Drives the judge (lib/eval/judge.ts) over the hand-written fixtures
# (lib/eval/fixtures.ts): for each case it scores the GROUNDED answer and the
# HALLUCINATED answer on the 1..5 rubric, then asserts the grounded answers score
# higher on average — evidence the assistant's "answer only from context"
# contract is measurable and that the judge separates faithful from fabricated
# answers. Prints the per-case scores and the average groundedness.
#
#   bash scripts/eval-assistant.sh                     # local Ollama (default)
#   LLM_PROVIDER=claude bash scripts/eval-assistant.sh # Claude (needs ANTHROPIC_API_KEY)
#
# Best-effort: needs a usable LLM. For the local path, start Ollama and pull the
# model first:
#   docker compose --profile llm up -d ollama
#   docker compose exec ollama ollama pull llama3.2:1b   # matches OLLAMA_MODEL
#
# Exit 0 + "ASSISTANT JUDGE EVAL OK" only when grounded > hallucinated on average.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[ -f .env ] || cp .env.example .env

PROVIDER="${LLM_PROVIDER:-ollama}"
MODEL="$(grep -E '^OLLAMA_MODEL=' .env | cut -d= -f2 | tr -d '[:space:]')"; MODEL="${MODEL:-llama3.2:1b}"

if [ "$PROVIDER" = "ollama" ]; then
  echo "==> start ollama (profile llm) + pull $MODEL"
  docker compose --profile llm up -d ollama >/dev/null
  docker compose exec -T ollama ollama pull "$MODEL" >/dev/null
  ok=0
  for _ in $(seq 1 30); do
    if docker compose exec -T ollama ollama list >/dev/null 2>&1; then ok=1; break; fi
    sleep 2
  done
  [ "$ok" = 1 ] || { echo "FAIL: ollama not ready"; exit 1; }
fi

# Harness lives under apps/web so the "@/" path alias resolves via tsconfig.
HARNESS="apps/web/.assistant-eval.ts"
cat > "$HARNESS" <<'TS'
import { judgeGroundedness } from "@/lib/eval/judge";
import { GROUNDEDNESS_FIXTURES } from "@/lib/eval/fixtures";

(async () => {
  let gSum = 0;
  let hSum = 0;
  let n = 0;
  console.log("case                         grounded  hallucinated");
  for (const c of GROUNDEDNESS_FIXTURES) {
    const g = await judgeGroundedness({
      context: c.context,
      question: c.question,
      answer: c.grounded,
    });
    const h = await judgeGroundedness({
      context: c.context,
      question: c.question,
      answer: c.hallucinated,
    });
    // Sentinel (0 = judge unavailable) is excluded from the averages.
    if (g.score > 0 && h.score > 0) {
      gSum += g.score;
      hSum += h.score;
      n += 1;
    }
    console.log(
      `${c.name.padEnd(28)} ${String(g.score).padStart(8)}  ${String(h.score).padStart(12)}`,
    );
  }
  if (n === 0) {
    console.error("ERR: judge returned no usable scores (is the LLM configured?)");
    process.exit(2);
  }
  const gAvg = gSum / n;
  const hAvg = hSum / n;
  console.log(`\navg grounded=${gAvg.toFixed(2)}  avg hallucinated=${hAvg.toFixed(2)}  (n=${n})`);
  if (gAvg > hAvg) {
    console.log("PASS: grounded answers scored higher on average.");
    process.exit(0);
  }
  console.error("FAIL: grounded answers did not outscore hallucinated ones.");
  process.exit(1);
})().catch((e) => {
  console.error("ERR", e?.message || e);
  process.exit(2);
});
TS
trap 'rm -f "$HARNESS"' EXIT

echo "==> judge fixtures through chatRouted() (provider=$PROVIDER)"
docker compose run --rm --no-deps \
  -e LLM_PROVIDER="$PROVIDER" -e OLLAMA_URL=http://ollama:11434 -e OLLAMA_MODEL="$MODEL" \
  -w /app web npx tsx .assistant-eval.ts

echo "ASSISTANT JUDGE EVAL OK"
