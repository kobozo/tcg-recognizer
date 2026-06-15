# Development & Operations Guide

Audience: the teacher validating this project. This document is the operational
companion to the README: how to **run, test, and operate** the TCG Card
Recognizer, and **why** it is wired the way it is. Every claim below is grounded
in a file in this repo (paths are cited inline).

The whole system runs locally via Docker Compose, deliberately mirroring a
production deployment (Postgres + a reverse proxy + separate inference service +
an MLflow tracking server). There is **no cloud dependency** required to validate
it.

---

## 0. Important: how to reach the app (LAN, no usable localhost)

The owner develops on this machine **remotely**, so there is no usable
`localhost` from the user's side. Everything that binds a port is published on
`0.0.0.0` and reached via the LAN IP **`192.168.3.177`**:

- App (through the Caddy reverse proxy): **http://192.168.3.177** (and
  https://192.168.3.177 with a self-signed cert).
- MLflow tracking UI: **http://192.168.3.177:5000**.

These two are the only host-published ports (`docker-compose.yml`: `proxy`
publishes 80/443, `mlflow` publishes 5000). The **inference**, **db**, **ocr**,
**qdrant**, and **ollama** services publish **no host ports** — they are only
reachable on the internal compose network (e.g. `http://inference:8001`). This is
intentional: the only public surface is the web app via the proxy. Tests that hit
inference/ocr/qdrant therefore do so with `docker compose exec`/`run` from
*inside* the network, never from the host (see `scripts/e2e-recognition-card.sh`,
`scripts/e2e-qdrant.sh`).

> HTTPS exists because **camera scanning needs a secure context**
> (`getUserMedia`). `Caddyfile` serves an internal-CA cert for the LAN IP and
> disables the http→https redirect so plain HTTP still works for CI/smoke.

Scripts default the host to `127.0.0.1` (not `localhost`) on purpose: Docker
publishes on IPv4, and `localhost` can resolve to `::1` first and give a false
"connection refused" (`scripts/smoke.sh` line ~5, `scripts/e2e-recognition.sh`).
Override with `PUBLIC_HOST=192.168.3.177`.

---

## 1. Quick start

```bash
git clone <repo> && cd Project
bash scripts/install.sh
```

`scripts/install.sh` is the one-shot installer. In order, it:

1. **Creates `.env`** from `.env.example` if missing (`install.sh` step 1).
2. **Builds and starts the stack**: `docker compose up -d --build` (step 2).
3. **Waits for the web app to be healthy** by polling `/api/health` (up to ~4
   min) (step 3).
4. **Seeds the admin account** (idempotent) by running Prisma's seed inside the
   web container: `node_modules/.bin/tsx prisma/seed.ts` (step 4).
5. **Runs an initial retrain**: `docker compose run --rm trainer` — this
   downloads the card images, builds the pgvector recognition index, and writes
   the first `ModelVersion` row so the admin MLOps view has a baseline (step 5).
6. **Installs a cron** that retrains on a schedule (default nightly `0 3 * * *`),
   calling `scripts/retrain.sh` (steps 6).

When it finishes it prints the access URLs (App + MLflow on `192.168.3.177`).

### Default admin login

The seed (`apps/web/prisma/seed.ts`) upserts an `ADMIN` user from `ADMIN_EMAIL` /
`ADMIN_PASSWORD` in `.env`. Defaults from `.env.example`:

- email: **`admin@tcg.local`**
- password: **`change-me-admin`**

Log in at http://192.168.3.177 with those to reach the admin section (users,
user-count, and the **MLOps model-rebuild view** where each retrain shows up as a
`ModelVersion` row).

### Retrain cron

```bash
# custom cadence (e.g. every 6h)
CRON_SCHEDULE="0 */6 * * *" bash scripts/install.sh
# remove the cron
bash scripts/install.sh --uninstall
```

`scripts/retrain.sh` runs `docker compose run --rm trainer`, appending to
`logs/retrain.log`. Each successful run writes a `ModelVersion` row and folds any
confirmed user feedback into the index (active learning — see §5).

### Manual start (without the installer)

```bash
cp .env.example .env
docker compose up -d --build        # app at http://192.168.3.177
```

> **Dev vs prod compose.** `docker compose up` automatically merges
> `docker-compose.yml` + `docker-compose.override.yml`. The **override** is the
> dev profile: it builds the web image's `build` stage, bind-mounts source for
> hot reload, runs `prisma migrate deploy && npm run dev`, runs inference with
> `--reload`, and adds a healthcheck the dev image otherwise lacks. To run the
> app exactly as production (standalone Next build, no source mounts) use
> `docker-compose.prod.yml` instead of the override — that is what the heavier
> e2e scripts do: `docker compose -f docker-compose.yml -f docker-compose.prod.yml …`
> (`scripts/smoke.sh`, `scripts/e2e-recognition.sh`, `scripts/e2e-flywheel.sh`).

---

## 2. Service & image overview

| Service | Build / image | Port (host) | Role | Source |
|---|---|---|---|---|
| `proxy` | `caddy:2-alpine` | **80, 443** | TLS + reverse proxy to web | `Caddyfile`, `docker-compose.yml` |
| `web` | `apps/web/Dockerfile` | via proxy only | Next.js UI + auth + admin + API routes | `apps/web/Dockerfile` |
| `inference` | `services/inference/Dockerfile` | internal `8001` | FastAPI `/predict` + `/health`, embedding + nearest-neighbour | `services/inference/Dockerfile` |
| `db` | `pgvector/pgvector:pg16` | internal `5432` | Postgres 16 **+ pgvector** (ANN index) | `docker-compose.yml` |
| `mlflow` | `ghcr.io/mlflow/mlflow:v2.22.0` | **5000** | MLOps tracking + model registry | `docker-compose.yml` |
| `sentinel` | `services/sentinel/Dockerfile` | internal | PR-shepherd agent (inert unless configured) | `services/sentinel/Dockerfile` |
| `trainer` | `services/trainer/Dockerfile` | n/a (run-once) | Builds the index / trains; profile `tools` | `services/trainer/Dockerfile` |
| `ocr` | `services/ocr/Dockerfile` | internal `8002` | OCR → text vector; profile `extras` | `services/ocr/Dockerfile` |
| `qdrant` | `qdrant/qdrant:v1.18.2` | internal `6333` | Text-vector search; profile `extras` | `docker-compose.yml` |
| `ollama` | `ollama/ollama` | internal `11434` | Local LLM/VLM serving; profile `llm` | `docker-compose.yml` |

**Profiles** keep the default `docker compose up` (and CI) lean: only services
*without* a `profiles:` key start by default. `trainer` (`tools`), `ocr`+`qdrant`
(`extras`), and `ollama` (`llm`) are opt-in (§4).

**Named volumes** (`docker-compose.yml`): `pgdata` (Postgres), `models` (shared
model artifacts, mounted into `inference` and `trainer`), `uploads` (scan
images), `mlflow_data`, `caddy_data`, `qdrant_storage`, `ollama_models`.
The card-image dataset is **bind-mounted** from the host `./ml/datasets`
(read-write for `trainer`, **read-only** for `inference` so geometric re-ranking
can load reference images).

**Why a shared `models` volume?** `embedding.py` and `rerank.py` are deliberately
duplicated byte-for-byte between `services/trainer` and `services/inference` (two
separate Docker build contexts that **must** agree on the embedding for pgvector
nearest-neighbour search to be meaningful). `scripts/check-dupes.sh` is a CI
guard that fails if the copies diverge.

---

## 3. Configuration reference (`.env.example`)

Copy `.env.example` to `.env`. The web and most services load it via
`env_file: .env`. The important knobs:

### Core / infra
| Var | Default | What it does |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `tcg` / `change-me-locally` / `tcg` | Postgres credentials. |
| `DATABASE_URL` | `postgresql://tcg:…@db:5432/tcg` | Prisma connection string (points at the `db` service). |
| `NODE_ENV` | `development` | Next.js mode. |
| `AUTH_SECRET` | placeholder | NextAuth signing secret — **set a real value** (`openssl rand -base64 32`). |
| `AUTH_TRUST_HOST` | `true` | Required for NextAuth behind the proxy. |
| `INFERENCE_URL` | `http://inference:8001` | Where web calls the recognizer (also pinned in compose). |
| `NEXT_PUBLIC_SITE_NAME` | `TCG Card Recognizer` | UI title. |
| `PUBLIC_HOST` | `192.168.3.177` | LAN host used by scripts to reach the app. |

### Admin seed
| Var | Default | What it does |
|---|---|---|
| `ADMIN_EMAIL` | `admin@tcg.local` | Owner admin account email (seeded). |
| `ADMIN_PASSWORD` | `change-me-admin` | Owner admin password (seeded; **change it**). |

### Product behaviour
| Var | Default | What it does |
|---|---|---|
| `ENABLED_GAMES` | `pokemon` | Which TCGs are switched on. Add more without code changes, e.g. `pokemon,magic`. The multi-TCG e2e flips this to `pokemon,magic` (`smoke.sh`). |
| `PREFERRED_CURRENCY` | `EUR` | Pricing currency (Belgium → EUR; Cardmarket / Scryfall eur). USD is a fallback only. |
| `POKEMON_TCG_API_KEY` | empty | Optional Pokémon TCG API key for enrichment / dataset download (higher rate limits; works empty but slower / rate-limited). |

### Recognition pipeline (the ML core)
| Var | Default | What it does |
|---|---|---|
| `MODEL_DIR` | `/models` | Where model artifacts (DINOv2 ONNX, learned head) are cached — the shared `models` volume. |
| `EMBEDDER` | `classical` | Embedding backend. `classical` = CPU hand-crafted 512-d descriptor (no download, default). `onnx` = learned **DINOv2-small** via onnxruntime (model lazily downloaded to `/models`). |
| `EMBED_HEAD` | empty | Path to a trained projection head (e.g. `/models/head.npz`). When set **and** `EMBEDDER=onnx`, a metric-learning MLP is applied on top of DINOv2 (in pure numpy) to make embeddings invariant to phone-photo conditions. Empty = off. Train it with `scripts/train-head.sh`. |
| `RERANK_TOP_K` | empty/0 | `>0` enables **geometric re-ranking**: `/predict` re-orders the embedding shortlist's top-K by ORB+RANSAC homography inliers vs each candidate's reference image. Cards are flat rigid objects, so this lifts recall@1 toward recall@K. Needs the dataset mounted (compose mounts it read-only). |

> **Index/query must match.** Whatever `EMBEDDER`/`EMBED_HEAD` you run inference
> with, the **index must be rebuilt with the same settings** (the trainer reads
> the same env). The recognition e2e enforces this by reading `.env` and passing
> the same values to the trainer (`scripts/e2e-recognition-card.sh`).

### OCR + Qdrant text channel (opt-in)
| Var | Default | What it does |
|---|---|---|
| `OCR_QDRANT` | empty | `1` enables folding OCR'd-text Qdrant matches into a scan's name candidates (an extra recognition channel). Requires the `extras` profile. |
| `OCR_URL` | `http://ocr:8002` | Web → OCR service URL. |

### MLOps
| Var | Default | What it does |
|---|---|---|
| `MLFLOW_TRACKING_URI` | `http://mlflow:5000` | In-network tracking server (trainer logs runs here). |
| `NEXT_PUBLIC_MLFLOW_URL` | `http://192.168.3.177:5000` | Browser link shown in the admin MLOps view. |

### AI collection assistant (text LLM router)
| Var | Default | What it does |
|---|---|---|
| `LLM_PROVIDER` | `auto` | `claude` \| `ollama` \| `auto`. `auto` prefers Claude when a key is set, else local Ollama, with fallback to the other. No key + no Ollama ⇒ assistant inert ("not configured"). |
| `ANTHROPIC_API_KEY` | empty | Enables the Claude backend. |
| `ASSISTANT_MODEL` | `claude-opus-4-8` | Claude model id for the assistant. |
| `OLLAMA_URL` | `http://ollama:11434` | Local Ollama endpoint. |
| `OLLAMA_MODEL` | `llama3.2:1b` | Local text model (small — box is RAM-tight). |

### VLM-assisted recognition (opt-in)
| Var | Default | What it does |
|---|---|---|
| `VLM_ASSIST` | empty | `1`/`true`/`yes`/`on` enables a vision model to read the card and pick from the shortlist when recognition is uncertain. Off ⇒ scan path is byte-identical to before. |
| `VLM_PROVIDER` | `auto` | `claude` \| `ollama` \| `auto` (mirrors `LLM_PROVIDER`). |
| `VLM_MODEL` | `claude-opus-4-8` | Claude vision model (falls back to `ASSISTANT_MODEL`). |
| `OLLAMA_VISION_MODEL` | `llava:7b` | Local vision model (RAM-heavier than text). |

### Sentinel (PR-shepherd agent — inert by default)
| Var | Default | What it does |
|---|---|---|
| `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` | empty | GitHub App credentials. |
| `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN` | empty | Slack credentials. |
| `SENTINEL_REPO` | `kobozo/tcg-recognizer` | Repo Sentinel watches. |
| `SENTINEL_PAUSED` | `true` | Master kill-switch; stays inert until credentials + unpause are provided. |

---

## 4. Optional subsystems & how to enable them

### 4a. Best-accuracy recognition (DINOv2 + head + re-rank)

The production-best config (per `scripts/train-head.sh`):

```bash
# 1. Train the projection head (writes /models/head.npz on the shared volume)
bash scripts/train-head.sh
# 2. In .env:
EMBEDDER=onnx
EMBED_HEAD=/models/head.npz
RERANK_TOP_K=10
# 3. Rebuild the index with these settings, then restart inference
docker compose run --rm trainer
docker compose up -d --build inference
```

Validate the head **generalizes** (not just memorizes its training cards) with
the held-out-card eval (§5).

### 4b. `extras` profile — OCR + Qdrant text channel

```bash
docker compose --profile extras up -d --build qdrant ocr
# and set OCR_QDRANT=1 in .env to fold OCR matches into scans
```

### 4c. `llm` profile — local Ollama (assistant + VLM)

```bash
docker compose --profile llm up -d ollama
docker compose exec ollama ollama pull llama3.2:1b   # text  (OLLAMA_MODEL)
docker compose exec ollama ollama pull llava:7b      # vision (OLLAMA_VISION_MODEL)
```

Then set `LLM_PROVIDER=ollama` (assistant) and/or `VLM_ASSIST=1 VLM_PROVIDER=ollama`.
With `ANTHROPIC_API_KEY` set instead, the cloud Claude path is used and Ollama is
unnecessary.

### 4d. `tools` profile — the trainer

The trainer is run-once and behind the `tools` profile, so it doesn't run on a
plain `up`. Invoke it directly:

```bash
docker compose run --rm trainer            # build index / retrain (config.yaml defaults)
```

---

## 5. Testing

### 5a. Unit tests

- **Web (Vitest)** — `apps/web/__tests__/*.test.ts` (router, admin-guard, scan
  route, ocr channel, judge, register, db-schema, vlm, health):
  ```bash
  cd apps/web && npm ci && npm test      # "test": "vitest run" (package.json)
  ```
- **Inference (pytest)** — `services/inference/app/test_main.py`:
  ```bash
  cd services/inference && pip install -r requirements.txt && python -m pytest -q
  ```
- **Typecheck / lint** (run in the `review` workflow): `npm run typecheck`
  (`tsc --noEmit`) and `ruff check services/inference`.

### 5b. End-to-end script catalog (`scripts/`)

Each prints a sentinel line (e.g. `RECOGNITION E2E OK`) and exits non-zero on
failure. The recognition/flywheel ones download card images, so they are heavier
(run locally).

| Script | What it verifies | Notes |
|---|---|---|
| `smoke.sh` | Full product flow via the proxy: register → NextAuth login → scan Pokémon **and** Magic → result page → collection → sets hub → assistant → admin seed. | Flips `ENABLED_GAMES=pokemon,magic`. **Does `down -v`** (see warning below). Run in CI. |
| `e2e-recognition-card.sh` | **Inject real card images** into `/predict` and assert the correct card is the top match (rank-1 ≥ 80%, top-3 = 100%). | `N=` cards indexed, `NCHECK=` cards injected. Reads `EMBEDDER`/`EMBED_HEAD` from `.env` so index matches inference. |
| `e2e-recognition.sh` | A scan goes through the **real** embedding/pgvector path (`modelVersion=embed-v1*`), not the stub; a current `ModelVersion` is registered; an on-device precomputed embedding resolves to the exact card. | |
| `e2e-flywheel.sh` | Self-improving loop: scan persists embedding → user correction (`Feedback`) → trainer folds it into the index → the corrected label is now recognized. | |
| `e2e-llm.sh` | Local LLM round-trip through the app's router (`chatRouted` → Ollama). | Needs `llm` profile; pulls `OLLAMA_MODEL`. |
| `e2e-vlm.sh` | VLM disambiguation picks the right card (Blastoise vs decoys) via `vlmDisambiguate` → Ollama vision. | Needs `llm` profile; pulls `OLLAMA_VISION_MODEL`. |
| `e2e-qdrant.sh` | OCR + Qdrant channel: reindex → text search → OCR a generated PNG → search the OCR'd text. | Needs `extras` profile; all in-network. |
| `embed-parity.sh` | Server Python `embed()` and browser/Node `embedRgba()` produce the same **classical** 512-d vector (cosine ≥ 0.999). | Proves on-device classical embedding matches the index. |
| `onnx-parity.sh` | Same parity for **DINOv2** (`EMBEDDER=onnx`): server `_embed_onnx()` vs Node `embedRgbaOnnx()` on a real card (cosine ≥ 0.90). | Downloads the model + an image. |
| `eval-baselines.sh` | Builds the index per embedder and prints recall@1/@5/@10 on synthetic phone-photos (classical vs onnx). | `SUBSET=`, `EVAL_CARDS=`. |
| `eval-heldout.sh` | **Honest** generalization: index + eval a card range **disjoint** from the head's training set, with vs without the head (and optional re-rank). | Keep `HEAD_TRAIN_CARDS < SAMPLE_OFFSET`. |
| `eval-assistant.sh` | LLM-as-judge groundedness: grounded answers must outscore hallucinated ones on the 1..5 rubric. | Needs Claude or Ollama. |
| `check-dupes.sh` | The intentional `embedding.py`/`rerank.py` duplication is still byte-identical across trainer & inference. | CI guard. |

Run the two headline ones:

```bash
bash scripts/e2e-recognition-card.sh      # inject-card recognition (real /predict)
bash scripts/smoke.sh                      # full product smoke
```

> **⚠ `smoke.sh` (and `e2e-recognition.sh` / `e2e-flywheel.sh`) end with
> `docker compose down -v`**, which **deletes the volumes** (Postgres data, the
> built index, uploads). Do not run them against a stack whose data you want to
> keep. To run isolated from your main stack, give them a separate project name:
> ```bash
> COMPOSE_PROJECT_NAME=tcg-smoke bash scripts/smoke.sh
> ```
> This puts the smoke run in its own set of containers/volumes so your
> `install.sh` stack and its `pgdata`/`models` are untouched.

### 5c. CI (`.github/workflows/`)

- **`build-tests.yml`** (on PR + push to `main`):
  - `unit` — web `npm ci && npm test` (Vitest) **and** inference
    `pip install … && pytest`.
  - `smoke` — `bash scripts/smoke.sh` (needs `unit`).
  - `dupe-guard` — `bash scripts/check-dupes.sh`.
- **`review.yml`** (on PR):
  - `web-typecheck` — `npm run typecheck`.
  - `inference-lint` — `ruff check services/inference`.

---

## 6. ML operations

### 6a. Download the dataset

```bash
bash scripts/download-cards.sh                 # all cards, small images
IMAGE_SIZE=large bash scripts/download-cards.sh
DOWNLOAD_LIMIT=200 bash scripts/download-cards.sh   # quick subset
```

Runs `download.py` inside the trainer image (`--no-deps`: no Postgres/MLflow
needed). Writes the git-ignored cache `ml/datasets/pokemon/` and a manifest
`ml/datasets/pokemon/manifest.jsonl`, reused by every training run.

### 6b. Train / rebuild the index

```bash
docker compose run --rm trainer            # uses services/trainer/config.yaml defaults
```

`config.yaml` knobs (`game`, `sample_size` (`all` or an int), `embedder`,
`embed_dim`, `eval_cards/views/seed`, `rerank_top_k`) can each be overridden at
run time by the matching UPPER_SNAKE env var (e.g. `-e SAMPLE_SIZE=300`). A
successful run builds `card_vectors` (pgvector), writes a `ModelVersion`, logs to
MLflow, and (when mounted) writes `ml/metrics.json`.

### 6c. Train the projection head

```bash
bash scripts/train-head.sh
# tunables: HEAD_TRAIN_CARDS, HEAD_VIEWS, HEAD_EPOCHS, EVAL_SUBSET, EVAL_CARDS
```

Builds the trainer (CPU-only torch — head training only; the head is **applied**
in numpy at inference, per `services/trainer/Dockerfile`), precomputes DINOv2
features, trains an InfoNCE head to `/models/head.npz` (shared volume), then
measures DINOv2+head (+rerank) on the eval harness. Enable it in production via
`EMBEDDER=onnx` + `EMBED_HEAD=/models/head.npz` (§4a).

### 6d. Retraining cron

`scripts/install.sh` installs a crontab entry calling `scripts/retrain.sh`
(default `0 3 * * *`); logs to `logs/retrain.log`. Each run also folds confirmed
user feedback into the index (active learning — see `e2e-flywheel.sh`).

### 6e. DVC pipeline (reproducible training)

DVC versions the ~3.2 GB / ~20k-image dataset out of git and turns training into
a reproducible pipeline. Because this host has no usable pip/host-dvc, all `dvc`
commands run through `scripts/dvc.sh`, which prefers a native `dvc`, then `uvx
dvc`, then a one-off trainer container with the repo bind-mounted.

```bash
bash scripts/dvc.sh init
bash scripts/dvc.sh remote add -d local /repo/.dvc-remote
bash scripts/dvc.sh add ml/datasets/pokemon       # track dataset (pointer committed)
bash scripts/dvc.sh repro                          # real trainer run (train stage)
bash scripts/dvc.sh metrics show                   # recall@1/@5/@10 from ml/metrics.json
bash scripts/dvc.sh push                           # data -> ./.dvc-remote
```

- The `train` stage (`dvc.yaml`) runs `scripts/dvc-train.sh`, which reads
  `params.yaml` (`train.*`) and runs the dockerised trainer with matching env
  overrides; the trainer writes `ml/metrics.json` via the `./ml → /mlout` mount.
- The `download` stage (`scripts/dvc-download.sh`) is `frozen: true` (on-demand
  only; `dvc repro` won't auto-run it). Run it with `dvc repro -s download` then
  re-snapshot with `dvc add ml/datasets/pokemon`.
- `params.yaml` is the source of truth for `dvc repro` (set `sample_size: 300`
  for a fast end-to-end pipeline test, `all` for a full run). Full details:
  `docs/dvc.md`.

---

## 7. Database: migrations vs `db push`

The web container applies **migrations** at boot:
`apps/web/Dockerfile` CMD runs `prisma migrate deploy && node server.js`, and the
dev override runs `prisma migrate deploy && npm run dev`
(`docker-compose.override.yml`). Committed migrations live in
`apps/web/prisma/migrations/` (`…_init`, `…_add_game_to_scan`,
`…_add_feedback`). This is the authoritative path for the long-lived app DB.

Several **ML scripts** instead use `prisma db push --skip-generate
--accept-data-loss` against an ephemeral DB they bring up just to satisfy the
trainer's `ModelVersion` write (`e2e-recognition-card.sh`, `eval-baselines.sh`,
`eval-heldout.sh`, `train-head.sh`, `dvc-train.sh`). `db push` syncs the schema
without a migration history — correct for a throwaway/eval DB and it also
sidesteps the P3005 gotcha below.

---

## 8. Troubleshooting (real gotchas from the scripts)

- **Port 5000 already in use (MLflow).** `mlflow` publishes `0.0.0.0:5000:5000`
  (`docker-compose.yml`). On macOS especially, port 5000 is often taken
  (AirPlay/ControlCenter), and other local MLflow/Flask apps grab it too. If the
  `mlflow` container fails to bind, free the port or remap it (change the host
  side of the published port, and `NEXT_PUBLIC_MLFLOW_URL` accordingly).

- **Prisma `P3005: database schema is not empty.`** `migrate deploy` against a DB
  that already has tables but no `_prisma_migrations` history errors with P3005.
  The ML scripts avoid this by using `prisma db push --skip-generate
  --accept-data-loss` for their throwaway DBs (§7). For the *real* app DB, either
  start from an empty volume (so migrations apply cleanly) or
  `prisma migrate resolve` the baseline. The quickest reset for a local dev DB:
  `docker compose down -v` (deletes `pgdata`) then `up` again.

- **DVC metric / artifact owned by root.** A plain `docker compose run trainer`
  runs as root, so files it writes to the host bind-mount (`ml/metrics.json`)
  would be root-owned and host-side `dvc` couldn't manage them. The DVC/eval
  scripts therefore run the trainer **as the host user**:
  `docker compose run --rm --user "$(id -u):$(id -g)" …` (see
  `scripts/dvc-train.sh`, `scripts/eval-heldout.sh`,
  `scripts/e2e-recognition-card.sh`). If you ran the trainer as root and now have
  root-owned files in `ml/`, `sudo chown -R "$USER" ml`.

- **`smoke.sh` wiped my data.** It ends with `down -v`. Run it under a separate
  `COMPOSE_PROJECT_NAME` to isolate it from your main stack (§5b).

- **Inference "model not downloaded" / first onnx run slow.** With
  `EMBEDDER=onnx`, the DINOv2 model is **lazily downloaded** to `/models` on
  first use (no model is baked into the image — `services/inference/Dockerfile`).
  The first request/training after switching to `onnx` is slow; subsequent ones
  reuse the cached `models` volume.

- **App not healthy after `up`.** Check `docker compose logs web`. The proxy only
  starts once `web` is healthy (`depends_on: service_healthy`); a failed
  `migrate deploy` at boot will keep web unhealthy — inspect the web logs for the
  Prisma error.

- **`localhost` refuses the connection.** Use `127.0.0.1` or the LAN IP
  `192.168.3.177`; `localhost` may resolve to IPv6 `::1` where nothing is
  published (scripts already default to `127.0.0.1`).
```
