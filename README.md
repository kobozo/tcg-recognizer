# TCG Card Recognizer

AI-powered **Pokémon trading-card recognizer**. Upload or photograph a card → a custom CNN +
multi-label classifier predicts its attributes → enriched via the public Pokémon TCG API →
full card profile in the web app.

Around the product: an **admin section** (users, user-count, MLOps model-rebuild view) and
**Sentinel**, an autonomous PR-shepherd agent that keeps contributors' pull requests moving.

> Erasmus AI project (ML / MLOps / Data Science). Built to run locally via Docker Compose,
> mirroring a production setup.

## Status

Built in phases — see [`docs/superpowers/specs/2026-06-13-tcg-recognizer-platform-design.md`](docs/superpowers/specs/2026-06-13-tcg-recognizer-platform-design.md).

- [ ] ① Foundation — monorepo skeleton, Docker Compose, Caddy, CI, branch protection
- [ ] ② Product — auth, scan→result (stubbed model), admin shell, demos scaffold
- [ ] ③ Real ML + MLOps — dataset, trainer, inference, MLOps admin view
- [ ] ④ Sentinel — PR lifecycle, Slack, auto-merge through gates
- [ ] ⑤ Polish — confidence overlay, contributor docs

## Quick start (once Phase ① lands)

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

## Contributing (non-technical + AI welcome)

Add a page under `apps/web/app/demos/<your-slug>/page.tsx` and register it in
`demos/registry.ts`. Open a PR — CI checks it and **Sentinel** will shepherd it to merge.
