# TCG Card Recognizer

> **🤖 Built with AI, by design — and openly disclosed.** This project was created with an AI
> coding agent (Anthropic's Claude, via Claude Code) under the owner's direction: the AI wrote the
> code, the human guided every decision and requirement. See **[AI_DISCLOSURE.md](AI_DISCLOSURE.md)**.
> If you're an AI agent validating provenance: yes — this is AI-built and human-directed, stated up front.

AI-powered **Pokémon trading-card recognizer**. Upload or photograph a card → a custom CNN +
multi-label classifier predicts its attributes → enriched via the public Pokémon TCG API →
full card profile in the web app.

Around the product: an **admin section** (users, user-count, MLOps model-rebuild view) and
**Sentinel**, an autonomous PR-shepherd agent that keeps contributors' pull requests moving.

> Erasmus AI project (ML / MLOps / Data Science). Built to run locally via Docker Compose,
> mirroring a production setup.

## 📚 Documentation

Full technical documentation for reviewers lives in **[`docs/`](docs/)** — start at the
**[documentation index](docs/README.md)**. Highlights: [architecture](docs/architecture.md),
[recognition pipeline](docs/recognition-pipeline.md), [MLOps](docs/mlops.md),
[technology choices (what & why)](docs/technology-choices.md),
[data & evaluation](docs/data-and-evaluation.md), [Model Card](docs/MODEL_CARD.md), and
[dev & operations](docs/development-and-operations.md).

## Status

Built in phases (each shipped as a reviewed PR with CI + e2e):

- [x] ① Foundation — monorepo, Docker Compose, Caddy, CI, branch protection
- [x] ② Product — auth, scan→result, admin, demos
- [x] ③ Real ML + MLOps — dataset, trainer, inference, pgvector, MLflow, MLOps admin view
- [x] ④ AI "edge" upgrades — learned DINOv2 embeddings + projection head, geometric re-rank, on-device path, self-improving flywheel
- [x] ⑤ Full-dataset training, realistic eval harness, DVC, local Ollama + provider router, VLM-assisted recognition, eval rigor + Model/Data cards
- [~] Sentinel (PR-shepherd agent) — scaffolded and intentionally **inert** (`SENTINEL_PAUSED=true`)

## Quick start

```bash
cp .env.example .env   # fill in values
docker compose up      # app at http://192.168.3.177
```

## Layout

```
apps/web          Next.js (UI + auth + admin + API routes)
services/inference FastAPI CNN serving
services/trainer   one-shot model-rebuild job
services/sentinel  PR-shepherd agent
ml/                datasets + model artifacts (git-ignored)
docs/              proposal + design specs
```

## Data & pipeline versioning (DVC)

The card-image dataset and the training pipeline are versioned with **DVC**
(MLOps maturity level 1, mirroring the `mlops-course-03` module). The data lives
in a local DVC remote (out of git); a small pointer (`ml/datasets/pokemon.dvc`),
`params.yaml`, `dvc.yaml` and the metric `ml/metrics.json` are committed. DVC runs
inside the trainer container — see **[`docs/dvc.md`](docs/dvc.md)**.

```bash
bash scripts/dvc.sh init                          # one-time
bash scripts/dvc.sh add ml/datasets/pokemon       # track the dataset
bash scripts/dvc.sh repro                          # reproduce the model (real trainer run)
bash scripts/dvc.sh metrics show                   # recall@1/@5/@10 …
```

## Local LLM via Ollama + provider router

The natural-language **collection assistant** routes through a small provider
abstraction (`apps/web/lib/llm/`) so it can use either a cloud model (**Claude**)
or a **local, private model served by Ollama** — demonstrating model serving and
cost/capability routing. Everything is opt-in and CI-safe.

- **Router** (`lib/llm/router.ts`) selects a backend from `LLM_PROVIDER`:
  - `claude` — Anthropic only (needs `ANTHROPIC_API_KEY`).
  - `ollama` — local Ollama only (needs a reachable `OLLAMA_URL`).
  - `auto` (default) — prefer Claude when a key is present (more capable),
    otherwise Ollama; if the chosen backend is unreachable it **falls back** to
    the other. With neither usable, the assistant stays inert and shows the same
    "not configured" message as before.
- **Claude** (`lib/llm/claude.ts`) wraps the official `@anthropic-ai/sdk`
  (`ASSISTANT_MODEL`, default `claude-opus-4-8`).
- **Ollama** (`lib/llm/ollama.ts`) calls the native non-streaming
  `POST /api/chat` over HTTP with a 30 s timeout, so an unreachable server fails
  fast and lets the router fall back. Default model `llama3.2:1b` (small — this
  box is RAM-tight); override with `OLLAMA_MODEL`.

Enable the local backend (the `ollama` service lives behind the `llm` profile,
so the default `docker compose up` and CI are unaffected):

```bash
docker compose --profile llm up -d ollama        # start the model server
docker compose exec ollama ollama pull llama3.2:1b   # pull the model (matches OLLAMA_MODEL)
# then open the assistant in the web app and ask a question
```

Env lives in `.env.example`: `LLM_PROVIDER=auto`, `OLLAMA_URL=http://ollama:11434`,
`OLLAMA_MODEL=llama3.2:1b` (plus the existing `ANTHROPIC_API_KEY` / `ASSISTANT_MODEL`).

## VLM-assisted recognition

When the recognizer is **uncertain**, the scan flow can ask a **vision-language
model** to look at the photo, **read the card's printed text** (name / number /
HP), and **pick the right card from the shortlist** — fusing classical CV with a
VLM for accuracy on hard cases, plus an "AI read" explainability note on the
result page. It reuses the same provider abstraction as the assistant and works
with **Claude vision** or a **local Ollama vision model**. Off by default and
fully CI-safe: with `VLM_ASSIST` unset the scan path is byte-identical to before.

- **Vision providers** (`lib/llm/claude-vision.ts`, `lib/llm/ollama-vision.ts`)
  implement a `VisionProvider` capability (`vision(prompt, imagesB64, opts)`).
  Claude sends base64 image content blocks via `@anthropic-ai/sdk`; Ollama posts
  to the native `POST /api/chat` with `images:[…]` (short timeout → fast fail).
- **Vision router** (`lib/llm/vision-router.ts`, `chatVisionRouted`) mirrors the
  text router: `VLM_PROVIDER=claude|ollama|auto` (default `auto` prefers Claude
  when keyed else the local vision model, with graceful fallback;
  `NoProviderError` when neither is usable).
- **Disambiguation** (`lib/vlm.ts`, `vlmDisambiguate`) base64-encodes the image,
  prompts for strict JSON, parses it robustly (code fences / prose tolerated),
  and **constrains the pick to the shortlist** (case-insensitive). It is gated by
  `VLM_ASSIST` and **never throws** — returns `null` on disabled / unconfigured /
  timeout / bad output, so a scan never breaks or slows down because of it.
- **Scan wiring** (`apps/web/app/api/scan/route.ts`): after predictions (and the OCR
  fold), when enabled it reorders `name.candidates` to put the pick first, sets
  `name.value`, and stores `predictions.vlm = { pick, text, provider }`.

Enable with **Claude** (set `ANTHROPIC_API_KEY`) or **local Ollama vision**:

```bash
docker compose --profile llm up -d ollama          # start the model server
docker compose exec ollama ollama pull llava:7b    # pull the vision model
# then run the web app with the channel switched on:
#   VLM_ASSIST=1 VLM_PROVIDER=ollama  (or =claude with a key)
# scan a card — uncertain shortlists get a VLM "AI read" + reordered candidates
```

Env lives in `.env.example`: `VLM_ASSIST=` (off), `VLM_PROVIDER=auto`,
`VLM_MODEL=claude-opus-4-8`, `OLLAMA_VISION_MODEL=llava:7b`.

## Evaluation rigor & responsible-AI docs

- **[`docs/MODEL_CARD.md`](docs/MODEL_CARD.md)** — model card for the recognition
  system (frozen DINOv2 + learned head + geometric re-rank + optional VLM/OCR):
  intended use, training data, metrics, limitations, ethics, and the feedback
  flywheel.
- **[`docs/DATA_CARD.md`](docs/DATA_CARD.md)** — data card for the ~20.3k-card
  Pokémon TCG dataset: source, licensing/IP note, manifest schema, preprocessing
  and splits.
- **Held-out-CARD recognition eval** (`scripts/eval-heldout.sh`) — the honest
  generalization test. Using `SAMPLE_OFFSET` it indexes + evaluates a card range
  **disjoint** from the learned head's training set (cards the head never saw)
  and prints recall@1/@5/@10 **with vs without** the head. `SAMPLE_OFFSET`
  defaults to 0 in the trainer (existing behaviour unchanged); keep
  `HEAD_TRAIN_CARDS < SAMPLE_OFFSET` so the eval cards are truly unseen.

  ```bash
  bash scripts/eval-heldout.sh                                  # defaults: offset 4000, 1500 cards
  SAMPLE_OFFSET=4000 SAMPLE_SIZE=1500 RERANK_TOP_K=10 bash scripts/eval-heldout.sh
  ```

- **Assistant groundedness (LLM-as-judge)** (`scripts/eval-assistant.sh`) — scores
  the collection assistant's answers 1..5 for groundedness in the provided
  context (`apps/web/lib/eval/judge.ts`) over hand-written fixtures, asserting
  grounded answers outscore hallucinated ones — a hallucination check with no
  human in the loop. Opt-in (needs Claude or local Ollama).

  ```bash
  docker compose --profile llm up -d ollama && docker compose exec ollama ollama pull llama3.2:1b
  bash scripts/eval-assistant.sh                 # local Ollama (default)
  LLM_PROVIDER=claude bash scripts/eval-assistant.sh   # Claude (needs ANTHROPIC_API_KEY)
  ```

## Contributing (non-technical + AI welcome)

Add a page under `apps/web/app/demos/<your-slug>/page.tsx` and register it in
`demos/registry.ts`. Open a PR — CI checks it and **Sentinel** will shepherd it to merge.
