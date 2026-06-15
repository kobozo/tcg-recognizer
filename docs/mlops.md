# MLOps in the TCG Card Recognizer

This document describes the MLOps practices implemented in this project and maps
each one to the concepts taught in the MLOps course (the instructor's
`mlops-course-01..04` modules: Terraform/IaC, GitHub Actions, DVC + Docker,
end-to-end MLflow tracking/registry + CI/CD + retraining).

The "model" here is an **image-retrieval recognizer**: each official card image
is embedded into a 512-d vector and stored in a Postgres + `pgvector` index;
inference is a nearest-neighbor query. "Training" therefore means *building (or
rebuilding) that vector index*. This shape matters: it lets the same pipeline,
tracking, registry and retraining concepts apply, while the heavy artefact is a
DB table rather than a `.pkl` weight file.

A short honesty note up front (see also the last section): everything described
below is **implemented and runnable on this host**. The parts of the course that
target **cloud infrastructure — Terraform/IaC (course 01/02) and AWS ECR/App
Runner deployment (course 04)** — are **deliberately NOT done**; this project
runs the equivalent stack locally via Docker Compose and a cron job. That is
called out explicitly where relevant.

---

## 1. Config-driven pipeline (ingestion → training → evaluation)

**What.** The trainer is a single orchestrator,
`services/trainer/src/main.py:main()`, that runs three modular stages in order:

1. `pipelines/ingestion.py:ingest()` — assemble the card list (from the local
   DVC-tracked dataset manifest, else a live API sample, else a synthetic
   fallback so a rebuild never hard-fails).
2. `pipelines/training.py:build_index()` — embed every card image with the
   shared 512-d descriptor and write the rows into the `card_vectors` pgvector
   table (this *is* the model artefact).
3. `pipelines/evaluation.py:evaluate()` — measure recall@k on held-out synthetic
   phone-photos (Section 5).

Behaviour is driven by `services/trainer/config.yaml` (keys: `game`,
`sample_size`, `embed_dim`, `eval_cards`, `eval_views`, `eval_seed`,
`rerank_top_k`). `main.py:load_cfg()` then layers **environment overrides** on
top: any key can be overridden by its `UPPER_SNAKE` env var (e.g. `SAMPLE_SIZE`,
`EVAL_CARDS`), which is how quick baseline sweeps and held-out-card evals are run
without editing files.

**Why.** A YAML config + env overrides separates *what to run* from *how to run
it*, so runs are declarative, comparable, and scriptable.

**Course concept.** This is the modular **ML pipeline** split
(ingestion → training → evaluation) and the `config.yml` parameterization
pattern from the course's pipeline modules — a step up from a single
imperative training script.

---

## 2. Experiment tracking — MLflow

**What.** `main.py` logs to an **MLflow** tracking server
(`docker-compose.yml` service `mlflow`, image `ghcr.io/mlflow/mlflow:v2.22.0`,
exposed on `:5000`, SQLite backend store + local artifact store).

For each run, `main()`:
- sets the tracking URI (`MLFLOW_TRACKING_URI`, default `http://mlflow:5000`) and
  experiment name `tcg-<game>`, and opens a run named after the model version
  (`main.py` lines ~181-199);
- logs **params** (`game`, `embed_model`, `sample_size`) via `log_params`;
- logs **metrics** (`recall_at_1/@5/@10`, `eval_queries`, `feedback_incorporated`,
  …) via `log_metrics`;
- logs an **artifact** — a per-version JSON model descriptor written to
  `MODELS_DIR` and uploaded with `log_artifact`.

**The optional / graceful design.** *Every* MLflow call is wrapped in
`try/except`. If the MLflow server is unreachable the trainer prints
`[mlflow] tracking unavailable; continuing without it` and the pgvector index
build + `ModelVersion` registry write still succeed. `GIT_PYTHON_REFRESH=quiet`
(compose) and the `mlflow-skinny` client keep MLflow from crashing on the
GitPython probe. This means the core pipeline and CI never depend on a running
tracking server.

**Why.** Tracking makes experiments reproducible and comparable (which params
produced which recall), but it must not be a single point of failure for the
production index rebuild.

**Course concept.** **Experiment tracking** (params/metrics/artifacts per run),
the MLflow component introduced in `mlops-course-04`.

---

## 3. Model registry — the Postgres `ModelVersion` table

**What.** Instead of (only) MLflow's registry, the authoritative registry is a
Postgres table the web app owns: `ModelVersion`
(`apps/web/prisma/schema.prisma`): `version` (unique), `metrics` (JSON),
`datasetSize`, `isCurrent` (bool), `trainedAt`.

`main.py:register_model_version()` writes a new row at the end of every run:
- it first runs `UPDATE "ModelVersion" SET "isCurrent" = false`, then inserts the
  new row with `isCurrent = true` — i.e. an atomic **promotion** of the latest
  run to "current";
- the stored `metrics` JSON embeds the `mlflow_run_id`, linking the registry row
  back to its MLflow run;
- it degrades gracefully: it skips the write (without failing the pipeline) if
  `DATABASE_URL` is unset or the `ModelVersion` table does not yet exist.

**Surfaced in the admin MLOps view.** `apps/web/app/admin/mlops/page.tsx` reads
`listModelVersions()` (`apps/web/lib/admin.ts`) and renders a table of every
version — `version`, `trainedAt`, `datasetSize`, `recall@1`, a deep link to the
MLflow run (`mlflow_run_id`), and a "current" badge for the promoted row. There
is an "Open MLflow" button to the tracking UI.

**Why.** The registry gives a versioned, queryable lineage of models with a
single source of truth for "which model is live" (`isCurrent`), and ties metrics
+ dataset size + the experiment-tracking run together.

**Course concept.** **Model registry / model versioning + lifecycle**
(`isCurrent` = the promotion/staging concept) from `mlops-course-04`.

---

## 4. Data & pipeline versioning — DVC (maturity level 1)

**What.** The large card-image dataset (`ml/datasets/pokemon`, **~3.2 GB,
~20,308 files** per `dvc.lock`) is tracked with **DVC**, not git. Git holds only
the pointer (`ml/datasets/pokemon.dvc`) and the pipeline definition; the blobs
live in a **local-filesystem remote** (`./.dvc-remote`, git-ignored — no cloud
account).

The pipeline is declared in `dvc.yaml`:
- a `train` stage whose `cmd` is `scripts/dvc-train.sh`, with deps
  (`services/trainer/src`, `config.yaml`, the DVC-tracked dataset), **params**
  pulled from `params.yaml` (`train.*`), and a **metric** output
  `ml/metrics.json` (committed to git, `cache: false`);
- a `frozen` on-demand `download` stage for (re)filling the dataset.

`scripts/dvc-train.sh` reads `params.yaml`'s `train.*` knobs and exports the
matching `UPPER_SNAKE` env vars, then runs the *real* dockerised trainer — so
`dvc repro` triggers a genuine training run with **no duplicated logic**. The
trainer writes the DVC metric to `ml/metrics.json` via the `./ml:/mlout` mount
(`main.py:write_metrics_file()`, default-safe: skipped if the mount is absent, so
plain `docker compose run trainer` and CI are unaffected). `dvc.lock` pins the
exact dataset hash, params, and metric of the last `repro`.

Because this host has **no usable pip and no host-level DVC**, `dvc` itself is
pinned in the trainer image (`requirements.txt: dvc==3.*`, core only — no cloud
extras) and run via `scripts/dvc.sh`, which resolves `dvc` → `uvx dvc` →
one-off trainer container. Full operational detail is in **`docs/dvc.md`**
(setup, `dvc add` / `push` / `pull`, dataset re-versioning with git tags
`data-v1`, `data-v2`, restoring on a fresh checkout); this section summarizes it.

**Why.** Large binary data does not belong in git; DVC versions it reproducibly,
keeps `code ↔ data ↔ metric` in lockstep, and makes a training run a single
`dvc repro`.

**Course concept.** This maps directly onto **`mlops-course-03` (Data
Versioning + Docker)** — `dvc init` → `remote add -d` → `dvc add` →
`push`/`pull` → pipeline stages with params & metrics — i.e. **MLOps maturity
level 1**. (The course's S3/cloud DVC remote is replaced by a local-filesystem
remote here — see the honesty section.)

---

## 5. Evaluation in the loop

**What.** `pipelines/evaluation.py:evaluate()` is an honest **recall@k harness**.
For a stride-sampled set of `eval_cards` indexed cards it generates `eval_views`
**held-out synthetic phone-photos** (`pipelines/photo_aug.py:make_photo` —
perspective, glare, blur, colour, JPEG), embeds each with the *same* embedder used
to build the index, and runs the *same* `pgvector` nearest-neighbor query the
inference service uses, checking the rank of the true card → `recall_at_1/@5/@10`.
The run is seeded (`eval_seed`) so runs are comparable. An optional geometric
re-rank (`rerank_top_k > 0`) additionally reports `rerank_recall_at_*`.

A genuinely **held-out-CARD** generalization eval is supported via
`sample_offset` (config / `SAMPLE_OFFSET`): it skips the first N manifest cards so
the evaluated range is disjoint from a learned head's training set
(`scripts/eval-heldout.sh`). Baseline sweeps live in `scripts/eval-baselines.sh`.

These metrics flow straight into the rest of the system: into MLflow
(`log_metrics`), into the `ModelVersion.metrics` JSON, and into `ml/metrics.json`
(the DVC metric). The doc-string in `evaluation.py` notes this replaced an
earlier near-circular eval that rotated the reference image and matched it against
itself — i.e. the eval was deliberately made *honest*.

**LLM-as-judge (adjacent eval).** A separate offline eval scores the collection
assistant's answers for **groundedness** on a 1..5 rubric using an LLM judge
(`apps/web/lib/eval/judge.ts`, fixtures in `apps/web/lib/eval/fixtures.ts`, run by
`scripts/eval-assistant.sh`). It is best-effort and never throws (returns 0 =
"could not judge" when no LLM is configured).

**Why.** A model without an evaluation harness can't be tracked, compared, or
trusted; tying eval to the same query path the product uses keeps the metric
meaningful.

**Course concept.** **Model evaluation as a pipeline stage** feeding the tracking
+ registry layers.

---

## 6. Monitoring / drift

**What.** `apps/web/lib/admin.ts:recognitionHealth()` computes a production
quality / drift signal over real user scans (the `Scan` table):
- `avgConfidence` — average prediction confidence
  (`predictions->'name'->>'conf'`);
- `lowConfidenceRate` — share of scans with confidence `< 0.6`;
- `feedbackCount` / `corrections` — human-in-the-loop volume
  (`Feedback` rows, and those where `correct = false`);
- `needsRetraining` — a boolean that trips when `avgConfidence < 0.6`.

The admin MLOps page (`apps/web/app/admin/mlops/page.tsx`) renders these as cards
and shows a **"consider retraining"** danger badge when `needsRetraining` is true.

**What would trigger retraining.** A *falling average confidence* or a high
*correction rate* are the documented cues: the cards make this visible to the
operator, and the cron (Section 8) retrains on a cadence so any drift is folded
out automatically on the next rebuild.

**Why.** Models degrade as the input distribution shifts (new card sets, new
phone cameras). Monitoring confidence + corrections is a lightweight drift proxy
that doesn't require labelled production data.

**Course concept.** **Monitoring / data drift** (the motivation the course gives
for versioning + retraining), surfaced as an operator-facing dashboard.

---

## 7. Self-improving flywheel / active learning

**What.** Real users confirm or correct each recognition:
- `apps/web/app/api/feedback/route.ts` records a `Feedback` row per scan
  (`predictedName`, `correctedName`, `correct`) — see the `Feedback` model in
  `schema.prisma`; each row is a free (real-photo embedding → correct card name)
  label.
- On the next rebuild, `main.py:incorporate_feedback()` reads confirmed/corrected
  feedback joined to its scan, pulls the **real photo's embedding** persisted in
  the scan's `predictions->'embedding'`, and inserts it into `card_vectors` as an
  extra reference vector keyed `fb:<id>`. So future similar photos match the
  confirmed card. It is entirely in-DB (no image re-access) and best-effort
  (skips on any error). The count is logged as the `feedback_incorporated` metric.

The admin page states this explicitly: "Confirmed feedback is folded back into the
index on the next rebuild (active learning)."

**Why.** This closes the loop: production usage generates labels that improve the
model with zero extra annotation cost — a data flywheel.

**Course concept.** **Active learning / continuous training** — the
"data changes → retrain" automation the course frames as the goal of a mature
pipeline.

---

## 8. Retraining (scheduled)

**What.** `scripts/install.sh` is a one-shot installer that brings up the stack,
runs an initial retrain (so there's a baseline `ModelVersion` + a populated
index), and installs a **cron** job. The default cadence is **nightly at 03:00**
(`CRON_SCHEDULE`, default `0 3 * * *`; overridable, e.g. `0 */6 * * *`). The cron
runs `scripts/retrain.sh`, which does `docker compose run --rm trainer` and
appends to `logs/retrain.log`. `install.sh --uninstall` removes the cron.

Each successful retrain (a) writes a new `ModelVersion` row (promoted to
`isCurrent`) and (b) folds confirmed feedback into the index. So **the
`ModelVersion` row count is the retrain log**, visible in the admin MLOps view,
and `logs/retrain.log` is the operational trail.

**Why.** Scheduled retraining keeps the index fresh against new card sets and
continuously absorbs the feedback flywheel, without manual intervention.

**Course concept.** **Automated retraining**. The course (`mlops-course-04`)
triggers retraining on code/data change in cloud CI; here it is a **local cron**
on this single host — the same idea (automation, not click-ops) at the scope this
project runs in.

---

## 9. CI/CD — GitHub Actions

Two workflows under `.github/workflows/` gate every pull request (and pushes to
`main`):

`build-tests.yml`:
- **`unit`** — `apps/web` Jest/unit tests (`npm test`) **and** the inference
  service's `pytest` suite. Guards core web + ML-serving logic.
- **`smoke`** (needs `unit`) — `scripts/smoke.sh`, an end-to-end stack smoke test
  from a fresh `.env`. Guards that the whole compose stack actually comes up.
- **`dupe-guard`** — `scripts/check-dupes.sh`, blocks duplicated/copy-paste code
  drift.

`review.yml`:
- **`web-typecheck`** — `npm run typecheck` on `apps/web` (strict TS). Guards
  type safety.
- **`inference-lint`** — `ruff check services/inference`. Guards Python style /
  obvious errors in the inference service.

Plus **CodeRabbit** automated PR review (configured via `CODEOWNERS` + the repo's
review setup) for an AI second pair of eyes on every PR.

**Why.** CI is the gate that keeps `main` releasable and reproducible: tests +
typecheck + lint + a full-stack smoke run before merge.

**Course concept.** **CI/CD with GitHub Actions** (`mlops-course-02`/`04`). The
course's CD step deploys to AWS (ECR/App Runner); here CD is local (the cron-driven
retrain + `docker compose up` on this host) — see the honesty section.

---

## 10. Reproducibility & containerization

**What.** Every service is a Docker image, orchestrated by `docker-compose.yml`:
web (Next.js), inference, OCR, sentinel, trainer, plus pinned infrastructure
images — `pgvector/pgvector:pg16` (DB), `ghcr.io/mlflow/mlflow:v2.22.0`,
`caddy:2-alpine`, `qdrant/qdrant:v1.18.2`, `ollama/ollama`.

Pinning is applied **where it matters for reproducibility**: the trainer
(`services/trainer/Dockerfile` + `requirements.txt`) pins
`mlflow-skinny==2.22.0`, `requests==2.32.3`, `pyyaml==6.0.2`, `dvc==3.*`, and
installs **CPU-only `torch==2.5.1`** from the CPU wheel index (lean image; torch
is trainer-only, used to train the small projection head, and applied in pure
numpy at inference). `git` is installed in the trainer image because DVC needs an
SCM-tracked repo. The MLflow client and server are both pinned to `2.22.0`.

**Why.** Containerization + pinned versions = the same pipeline runs identically
on CI, this host, or a teammate's machine — the foundation reproducibility rests
on.

**Course concept.** **Model containerization / reproducible environments**
(`mlops-course-03`'s Docker half).

---

## 11. Honest scope: implemented vs. aspirational

**Implemented and runnable on this host:**
- Config-driven 3-stage pipeline (Section 1)
- MLflow experiment tracking, optional/graceful (Section 2)
- Postgres `ModelVersion` registry with `isCurrent` promotion, surfaced in admin
  (Section 3)
- DVC data + pipeline versioning, local-filesystem remote, `dvc repro`, metrics
  (Section 4)
- Honest recall@k eval harness + held-out-card eval + LLM-judge groundedness eval
  (Section 5)
- Drift monitoring (`recognitionHealth`) (Section 6)
- Active-learning feedback flywheel (Section 7)
- Scheduled retraining via cron (Section 8)
- CI on every PR: unit, smoke e2e, typecheck, lint, dupe-guard, CodeRabbit
  (Section 9)
- Per-service Docker images, pinned (Section 10)

**Deliberately NOT done (the cloud half of the course):**
- **No Terraform / Infrastructure-as-Code** (`mlops-course-01`/`02`). There is no
  `*.tf` in the repo; infra is `docker-compose.yml`, not provisioned cloud.
- **No cloud deployment** (`mlops-course-04`'s AWS ECR + App Runner). Images are
  built locally, not pushed to a cloud container registry; the app is served by a
  local Caddy reverse proxy on this LAN host.
- **No cloud DVC remote / cloud artifact store.** The DVC remote is a local
  directory (`./.dvc-remote`) and MLflow's artifact store is a local volume — no
  S3/GCS. DVC is installed without cloud extras on purpose.
- **CD is local** — the "deploy" step is the cron-driven retrain + `docker compose`
  on this single host, not an automated cloud rollout.

These omissions are intentional: the project demonstrates the full MLOps *control
loop* (track → register → version → monitor → retrain → CI) on a single
self-hosted box, and substitutes local equivalents for every cloud component the
course uses.
