# LLM features and the collection assistant

This document describes the large-language-model (LLM) and vision-language-model
(VLM) features of the TCG card recognizer, and — for the AI-course assessment —
the *design reasoning* behind them. The recurring theme is a **pluggable provider
abstraction** that lets the same feature run against a capable cloud model
(Anthropic Claude) **or** a private, cheap, self-hosted local model (Ollama),
with graceful fallback and a safe inert default.

All claims below are grounded in source; file paths are given inline.

---

## 1. Why a provider abstraction at all

An AI course cares about more than "call an API". The design here makes three
trade-offs explicit and configurable:

- **Cost vs. capability.** Claude is the most capable backend but bills per
  token; a local model is effectively free to run but weaker. The router lets a
  deployment pick either, or prefer Claude when a key is present and fall back to
  local otherwise.
- **Privacy / data residency.** The collection assistant sends a summary of the
  user's collection to the model. Routing to a *local* Ollama model means that
  data never leaves the box — a real concern for a "run-it-yourself" deployment.
- **Run-it-yourself model serving.** Being able to stand up your own model server
  (Ollama) instead of depending on a hosted API is itself an AI-course theme; the
  abstraction makes the local path a first-class citizen, not an afterthought.

The same two-implementations-behind-one-interface pattern is applied twice: once
for **text chat** (`LlmProvider`) and once for **vision** (`VisionProvider`).

---

## 2. Provider abstraction and the router (text)

### 2.1 The `LlmProvider` interface

Defined in `apps/web/lib/llm/types.ts`. It is deliberately minimal so any model
service can be wrapped behind one shape:

- `name` — stable id, `"claude"` or `"ollama"`.
- `isConfigured()` — true when the provider has enough config (key/URL) to be
  *attempted*. This is a cheap, synchronous check; actual reachability is proven
  lazily inside `chat()`.
- `chat(messages, opts)` — a single non-streaming completion returning assistant
  text. `ChatMessage` is `{ role: "system" | "user" | "assistant"; content }`;
  `ChatOptions` carries `maxTokens`, `temperature`, and a `timeoutMs` guard
  against hung calls.

### 2.2 `ClaudeProvider` (cloud)

`apps/web/lib/llm/claude.ts`. Wraps the official `@anthropic-ai/sdk`.

- Authenticated by `ANTHROPIC_API_KEY` (read from env by the SDK constructor);
  `isConfigured()` is simply "is that key set".
- Model is `process.env.ASSISTANT_MODEL ?? "claude-opus-4-8"` — the latest
  capable Claude model at time of writing, chosen as the default because the
  assistant benefits from strong instruction-following and groundedness. The
  default is overridable via `ASSISTANT_MODEL`, so the choice is not hard-wired.
- Anthropic takes the `system` prompt as a separate parameter, so the provider
  splits `system` turns out of the message list and joins them, passing the rest
  as `user`/`assistant` turns.
- **Temperature handling (important detail).** `supportsTemperature(model)`
  returns `false` for any model id matching `^claude-(opus-4|fable)`. The Opus
  4.x and Fable families **removed** sampling parameters and return HTTP 400 if
  `temperature` is sent, so the provider *omits* `temperature` for those models
  even when the caller supplied one. The regex is forward-compatible across point
  releases in those families. `max_tokens` defaults to 1500; request `timeout`
  defaults to 60 s.

### 2.3 `OllamaProvider` (local)

`apps/web/lib/llm/ollama.ts`. Talks HTTP to a local Ollama server.

- Uses the native non-streaming `POST /api/chat` endpoint
  (`{ message: { content } }`).
- `url` defaults to `http://ollama:11434` (`OLLAMA_URL`); `model` defaults to
  `llama3.2:1b` (`OLLAMA_MODEL`) — a small model chosen because the host is
  RAM-tight.
- **`isConfigured()` returns true by default** because `OLLAMA_URL` is always
  set. Ollama is therefore considered "available" optimistically; if the server
  is down, `chat()` fails *loudly* (a clear "Ollama unreachable…" error) so the
  router can fall back. There is a 30 s `AbortSignal.timeout`.
- Temperature/`num_predict` are forwarded as Ollama `options` only when provided.
  Local models accept `temperature`, so there is no Opus-style omission here.

### 2.4 The router

`apps/web/lib/llm/router.ts`. Pure selection logic plus a fallback runner.

- **Mode** comes from `LLM_PROVIDER` via `parseMode()`: `"claude" | "ollama" |
  "auto"` (anything else → `auto`).
- **`selectProviders(mode, claude, ollama)`** returns the ordered list to try:
  - `claude` → `[claude]` if configured, else `[]`.
  - `ollama` → `[ollama]` if configured, else `[]`.
  - `auto` → **prefer Claude when configured** (it is more capable), else
    Ollama; *both* are listed (filtered to configured ones) so an unreachable
    primary falls back to the other.
- **`chatWith(providers, …)`** tries each provider in order, returning the first
  success and remembering the last error; if the list is empty it throws
  `NoProviderError`, and if all fail it rethrows the last error.
- **`NoProviderError`** is the "nothing usable" signal. Callers translate it into
  the existing **inert "not configured"** behavior rather than a crash.
- `chatRouted(messages, opts)` is the env-driven entry point used by the
  assistant and the judge; `getProvider()` returns the first usable provider (or
  `undefined`) for cheap "is anything configured?" checks.

**Why this shape:** the precedence rule encodes the cost/capability trade-off
(use the strong cloud model if you paid for it, otherwise the free local one),
fallback encodes resilience, and `NoProviderError` keeps the feature *safe by
default* — with no key and no reachable Ollama, the app degrades to a friendly
message instead of erroring.

---

## 3. The collection assistant (RAG)

`apps/web/lib/assistant.ts`, exposed at `POST /api/assistant`
(`apps/web/app/api/assistant/route.ts`) and the chat UI
`apps/web/app/assistant/page.tsx`.

This is a small **retrieval-augmented-generation** feature: the "retrieval" is a
structured summary of the user's own collection from the database, and the
"generation" is the router answering questions strictly over that summary.

### 3.1 Building a token-bounded context

`buildCollectionContext(userId)` reads the user's scans (newest first) and
assembles a compact plain-text context, deliberately bounded so the prompt stays
small:

- **Totals:** total card count and total estimated value
  (`formatTotals(priced)`).
- **Games** present (resolved to display names).
- **Per-set completion:** for each game present it loads official set totals via
  the game provider, then prints `game · set: owned/total, value`, sorted by
  value descending. Completion = owned over the official set total.
- **EUR value:** prices are point-in-time snapshots; the user is in Belgium so
  the assistant treats values as EUR (`PREFERRED_CURRENCY=EUR`).
- **Recent cards:** a sample of **up to 60** recent cards (name · set · rarity ·
  price). The cap is what keeps the prompt token-bounded.
- Empty collections return `"The collection is currently empty."`

### 3.2 Answering via the router

`askAssistant(userId, question)`:

1. If `assistantConfigured()` (i.e. `getProvider()` found a usable backend) is
   false, it returns the **inert** message — *"The AI assistant isn't configured
   yet. Add ANTHROPIC_API_KEY … or run the local Ollama model …"* — and never
   calls a model.
2. Otherwise it builds the context, composes a `system` prompt that instructs the
   model to answer **using only the data provided** (concise, practical, EUR,
   "say so plainly" when data is insufficient), and calls
   `chatRouted([system, user-question], { maxTokens: 1500 })`.
3. A `NoProviderError` raised mid-flight is folded back into the same inert
   message; other errors return a readable `"The assistant request failed: …"`.

The API route adds auth (`401` when unauthenticated), JSON/length validation
(question required, max 2000 chars), and deliberately returns errors with HTTP
200 so the chat UI can render them as a normal assistant turn. The UI itself
(`app/assistant/page.tsx`) is a thin client with suggested prompts ("What's my
collection worth?", "Which set am I closest to completing?", …).

**Why "only from the provided data":** constraining the model to the retrieved
context is what makes the feature *evaluable* for groundedness (section 6) and is
the responsible-AI posture for a tool that talks about a user's real holdings.

---

## 4. VLM-assisted recognition

The recognizer is classical-CV first. When it is *uncertain*, a vision-language
model reads the photographed card and disambiguates the shortlist. This fuses
classical CV with a VLM for accuracy on hard cases plus explainability.

### 4.1 Vision providers and router

The vision side mirrors the text side exactly so behavior stays consistent:

- **`VisionProvider`** interface (`apps/web/lib/llm/types.ts`): same `name` /
  `isConfigured()` shape, with `vision(prompt, imagesB64, opts)` taking
  base64-encoded images (no `data:` prefix).
- **`ClaudeVisionProvider`** (`apps/web/lib/llm/claude-vision.ts`): sends images
  as base64 content blocks alongside the text prompt in one `messages.create`
  turn. Model is `VLM_MODEL ?? ASSISTANT_MODEL ?? "claude-opus-4-8"`. It applies
  the same Opus/Fable `supportsTemperature` omission. **Media-type sniffing:**
  `detectMediaType()` inspects the base64 leading bytes to declare
  `image/jpeg | png | gif | webp`, because Anthropic returns HTTP 400 if the
  declared `media_type` doesn't match the actual bytes (card *references* are PNG,
  camera *captures* are JPEG, so it cannot be hard-coded). `max_tokens` defaults
  to 512, timeout 20 s.
- **`OllamaVisionProvider`** (`apps/web/lib/llm/ollama-vision.ts`): same
  `POST /api/chat` with `images` attached to the user message. Model defaults to
  `llava:7b` (`OLLAMA_VISION_MODEL`). Fails loudly if unreachable so the router
  can fall back.
- **`vision-router.ts`**: `selectVisionProviders` / `visionWith` /
  `chatVisionRouted` mirror the text router, driven by `VLM_PROVIDER`
  (`claude | ollama | auto`, default `auto`, same Claude-preferred precedence and
  graceful fallback). `visionWith` additionally returns *which* provider answered,
  for explainability.

### 4.2 `vlmDisambiguate`

`apps/web/lib/vlm.ts`, wired into the scan path at
`apps/web/app/api/scan/route.ts:104`.

- **Gated** by `VLM_ASSIST` (`vlmEnabled()` accepts `1/true/yes/on`) **and** a
  usable vision backend. Off by default, so the default stack and CI never call a
  vision model and the scan path is byte-identical unless enabled.
- **Triggered only when uncertain:** the scan route invokes it only when
  `predictions.name.conf < 0.6` (the same threshold used to surface candidates),
  so a confident recognition is never overwritten.
- It base64-encodes the image, builds a prompt asking the model to **read** the
  card and return JSON `{pick, name, number, hp}`, choosing `pick` from the
  supplied candidate shortlist, and routes via `chatVisionRouted` with a short
  reply budget (`VLM_MAX_TOKENS`, default 160) and generous timeout
  (`VLM_TIMEOUT_MS`, default 60 s — a local CPU VLM generates slowly).
- **Two-tier parsing for big-vs-small models:** capable models (Claude) return
  the requested JSON, parsed by `parseVlmJson` (strips code fences, extracts the
  first balanced `{…}`). Small local models (e.g. llava) often answer in prose
  like "This is a Blastoise card"; `matchCandidateInText` recovers the pick by
  scanning the free text for any candidate name (longest first, so a short name
  doesn't match inside a longer one). The result is always **constrained to the
  shortlist** (`matchCandidate`) — an off-list guess yields `null` and the
  existing prediction is kept.
- **Best-effort and never throws:** disabled, no backend, timeout, or bad JSON
  all return `null`, keeping the scan path safe.
- On a successful pick the scan route reorders candidates so the VLM's pick is
  first and stores the read (`predictions.vlm`) for explainability.

**Local llava vs. Claude vision:** the same disambiguation runs against a private
local `llava:7b` (free, slow on CPU, prose-prone) or Claude vision (fast,
reliable JSON, billed) — the JSON-or-prose handling is precisely what lets one
code path serve both ends of the capability spectrum.

---

## 5. Local model serving with Ollama

`docker-compose.yml` defines an **opt-in** `ollama` service behind the `llm`
profile, so the default `docker compose up` and CI are unchanged. The `web`
service is pre-wired with `OLLAMA_URL: http://ollama:11434`; the compose comment
notes this is harmless when the service is down because the router falls back to
Claude or to the inert message.

Bring it up and pull models on demand:

```
docker compose --profile llm up -d ollama
docker compose exec ollama ollama pull llama3.2:1b   # text  (OLLAMA_MODEL)
docker compose exec ollama ollama pull llava:7b      # vision (OLLAMA_VISION_MODEL)
```

Models persist in the `ollama_models` volume. **RAM considerations:** the host is
RAM-tight (the `.env.example` and README note this), which is why the defaults
are deliberately small — `llama3.2:1b` for text; `llava:7b` is heavier and used
only on the opt-in VLM path. (Per the deployment notes the box has ~24 GB RAM,
which comfortably runs these small models but not large ones — hence the small
defaults rather than, say, a 70B model.)

**Why local serving matters here:** it demonstrates self-hosted, private,
zero-marginal-cost inference for both the text assistant and the VLM channel, and
it is the default backend the groundedness eval runs against (section 6), so the
evaluation needs no paid API.

---

## 6. Evaluation: LLM-as-judge groundedness

Sub-project 7. Files: `apps/web/lib/eval/judge.ts`,
`apps/web/lib/eval/fixtures.ts`, harness `scripts/eval-assistant.sh`.

**What it measures.** The assistant is contracted to answer *only* from the
provided collection context. To check it stays grounded (i.e. does not
hallucinate), a *second* LLM — the "judge" — scores an answer 1..5 on a
groundedness rubric:

- 5 = every claim directly supported by the context; 1 = contradicts the context
  or invents facts. The rubric explicitly tells the judge to **penalize any
  number, name, set, or value not present in the context** and to reply with only
  `{"score", "reason"}`.

**How.** `judgeGroundedness({context, question, answer})` routes through the same
`chatRouted` (temperature 0 where supported, `maxTokens` 200), tolerantly parses
the JSON (`parseJudgeJson`, same fence-stripping approach as the VLM path), and
clamps the score to 1..5 (`clampScore`). It is **best-effort and never throws**:
a missing/unreachable judge or unparseable output yields the sentinel score `0`
("could not judge"), excluded from averages, so harnesses and unit tests stay
deterministic.

**Fixtures.** `fixtures.ts` provides five hand-written cases (set-completion,
total-value, most-valuable-card, empty-collection, game-coverage). Each pairs a
context + question with **two** answers: a `grounded` one (supported only by the
context) and a `hallucinated` one (invents facts — e.g. a "$900 graded Charizard"
or a "Mewtwo from Neo Genesis" never in the context).

**Harness & assertion.** `scripts/eval-assistant.sh` (defaulting to the local
Ollama judge; `LLM_PROVIDER=claude` switches to Claude) scores both answers for
every fixture and **asserts the grounded answers outscore the hallucinated ones
on average**, printing per-case and average scores. This makes the "answer only
from context" contract a measurable, no-human-in-the-loop responsible-AI eval.

**Measured result.** Per `docs/MODEL_CARD.md`, with a local `llama3.2` judge over
the 5 fixtures: **grounded avg 5.0 vs. hallucinated avg 1.2** — the judge cleanly
separates faithful from fabricated answers, and even a small local model is good
enough to act as the judge.

---

## 7. Model choice rationale (no overclaiming)

`claude-opus-4-8` is used as the default for both the text assistant
(`ASSISTANT_MODEL`) and Claude vision (`VLM_MODEL`) because it is the latest
capable Claude model available at the time of writing, and the assistant benefits
from strong instruction-following and groundedness. This is a *default*, not a
hard requirement: every model id is env-overridable, and the whole point of the
provider router is that the feature also runs on a small local model when cost or
privacy outweighs raw capability. No specific benchmark or superiority claim is
made beyond "latest capable default, overridable".

---

## Configuration reference (`.env.example`)

| Variable | Purpose | Default |
| --- | --- | --- |
| `LLM_PROVIDER` | text backend select: `claude` / `ollama` / `auto` | `auto` |
| `ANTHROPIC_API_KEY` | enables the Claude backend | empty (off) |
| `ASSISTANT_MODEL` | Claude text model | `claude-opus-4-8` |
| `OLLAMA_URL` | local Ollama endpoint | `http://ollama:11434` |
| `OLLAMA_MODEL` | local text model | `llama3.2:1b` |
| `VLM_ASSIST` | enable VLM-assisted recognition | empty (off) |
| `VLM_PROVIDER` | vision backend select: `claude` / `ollama` / `auto` | `auto` |
| `VLM_MODEL` | Claude vision model (falls back to `ASSISTANT_MODEL`) | `claude-opus-4-8` |
| `OLLAMA_VISION_MODEL` | local vision model | `llava:7b` |
| `VLM_TIMEOUT_MS` / `VLM_MAX_TOKENS` | per-call VLM guards | `60000` / `160` |
