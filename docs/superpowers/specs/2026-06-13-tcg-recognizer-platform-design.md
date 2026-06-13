# TCG Card Recognizer Platform — Design

**Date:** 2026-06-13
**Owner:** kobozo (backibaxter@gmail.com)
**Status:** Approved (phased build)
**Repo:** `kobozo/tcg-recognizer` (monorepo, private)

## 1. Purpose

An AI-powered **Pokémon trading-card recognizer**: a user uploads/photographs a card,
a custom-trained CNN + multi-label classifier predicts its attributes, predictions are
enriched via the public Pokémon TCG API, and the full card profile is shown in a web app.

Around the product sits the engineering wrapper the owner needs, because **non-technical
classmates working with AI** will contribute pages/features via branches and PRs:

- An **admin section** (owner-only): users, user-count over time, and an **MLOps view**
  of model rebuilds (versions, metrics, last-retrained).
- **Sentinel** — an autonomous "senior" PR-shepherd agent that babysits the PR lifecycle:
  tracks open PRs and their age, nudges testers on Slack, randomly assigns testers,
  chases approvals, and auto-merges + deletes branches once all gates are green.
- **Docker Compose** local-as-production + **GitHub Actions** CI (review checks + build tests).

This is the owner's Erasmus AI project, spanning the ML, MLOps, and Data Science modules.

## 2. Key decisions

- **Sentinel is a separate agent, not folded into the existing "Parry" agent.** Different
  trigger model (GitHub events + cron), much larger blast radius (it can merge to `main`),
  and different secrets (GitHub write token + Slack token). Separation keeps merges
  auditable and gives a clean kill-switch.
- **Monorepo** (owner decision): one repo holds the product *and* Sentinel. Sentinel still
  runs as its own isolated container with its own secrets — it just lives in the same repo,
  so there is one CI config and one branch-protection policy to manage.
- **Web stack: Next.js (App Router, TypeScript) + Tailwind + shadcn/ui.** File-based routing
  means contributors "add a folder = add a page"; a `app/demos/<slug>/` convention + a
  registry keeps contributor pages from breaking the global site chrome.
- **ML serving in Python (FastAPI).** Training is a one-shot job container.
- **Postgres** for users + model registry metadata; model **artifacts** live on a Docker
  volume. (Redis/Celery deliberately cut — manual rebuild trigger is enough for MVP.)
- **Caddy** as the single LAN ingress, bound to `0.0.0.0` so the app is reachable at
  `http://192.168.3.177` (owner works remotely; no usable localhost).

## 3. Repository layout (monorepo)

```
tcg-recognizer/
├─ docker-compose.yml            # base stack (all services)
├─ docker-compose.override.yml   # local dev: hot reload + source mounts
├─ docker-compose.prod.yml       # built images, restart policies, no mounts
├─ Caddyfile
├─ .env.example                  # placeholders; real .env is git-ignored
├─ apps/
│  └─ web/                       # Next.js: UI + auth + admin + API routes, Prisma → Postgres
├─ services/
│  ├─ inference/                 # FastAPI: CNN serving (/predict, /health, /model, /reload)
│  ├─ trainer/                   # one-shot training / model-rebuild job
│  └─ sentinel/                  # Node/TS PR-shepherd agent (inert until creds provided)
├─ ml/
│  ├─ datasets/                  # git-ignored; manifest.csv committed convention
│  └─ models/                    # git-ignored; versioned artifacts (volume in compose)
├─ .github/workflows/
│  ├─ review.yml                 # lint / format / type-check (+ optional AI review)
│  └─ build-tests.yml            # build images → unit tests → compose smoke test
└─ docs/
   ├─ TCG_Card_Recognizer_Proposal.pdf
   └─ superpowers/specs/...
```

## 4. Service topology (Docker Compose)

```
                 LAN  http://192.168.3.177
                          |
                  +-------v--------+
                  |  proxy (Caddy) |  host 0.0.0.0:80
                  +---+--------+---+
              / (UI+admin)  | /api/* (Next.js API routes)
                  +---------v---------+
                  |  web (Next.js)    |---> Pokémon TCG API (egress)
                  |  Prisma           |
                  +----+---------+----+
                       | /predict |  (proxied server-side)
                  +----v----+   +-v---------+
                  |inference|   |  db (PG)  |
                  +----+----+   +-----------+
                       | reads        ^ writes model_versions
                  +----v------+   +---+------+
                  | models vol|<--| trainer  |  (one-shot: compose run trainer)
                  +-----------+   +----------+

  sentinel (own container, same repo): node-cron + webhook listener
     ├─ Octokit (GitHub App)  → watches repo PRs, auto-merges through gates
     ├─ Slack Bolt            → escalating nudges, interactive tester buttons
     ├─ SQLite                → PR ages, assignments, audit log
     └─ tunnel (smee)         → delivers webhooks to local container
```

| Service | Role | Exposure |
|---|---|---|
| `proxy` (Caddy) | Single ingress, routes by path | host `0.0.0.0:80` → `192.168.3.177` |
| `web` (Next.js) | UI, auth (Auth.js), admin, API routes, Prisma | internal :3000 |
| `inference` (FastAPI) | Loads current model, `/predict` | internal :8001 |
| `trainer` | One-shot rebuild → versioned artifact + metrics | no port (run on demand) |
| `db` (Postgres) | users, model registry metadata | internal :5432 |
| `sentinel` (Node/TS) | PR-shepherd agent | internal; webhook via tunnel |

## 5. Product / UX

Routes: `/` landing · `/scan` upload→result · `/scan/[id]` shareable card profile ·
`/login` `/register` · `/account` scan history · `/admin` (role=admin) with
`/admin/users`, `/admin/metrics`, `/admin/mlops` · `/demos` (auto-listed contributor pages)
+ `/demos/[slug]`.

**Card-result screen:** uploaded photo + matched official art side by side; each predicted
attribute (name, type, set, rarity, card #) shown as a chip with a **confidence bar**
(green ≥85 / amber 60–84 / red <60). A visually distinct **"Verified from Pokémon TCG API"**
block holds enriched data (HP, attacks, market-price indicator) — separating model guesses
from authoritative data. Low confidence (<60%) → "did you mean?" top-3 candidates the user
can confirm (confirmation logged for future retraining). Errors render as friendly inline
states, never raw stack traces.

**"Wow" (MVP-scoped):** animated confidence overlay — matched fields snap onto the photo and
the official art cross-fades in, so the AI feels like it *sees* the card. Pure frontend over
data already produced.

**Contributor-safe pages:** every contributor page is a self-contained folder under
`apps/web/app/demos/<slug>/page.tsx`; a `demos/registry.ts` array feeds the `/demos` index;
a shared `<DemoLayout>` enforces site chrome. CODEOWNERS + PR template + per-demo branch;
CI runs lint+typecheck+build so a broken page fails its own PR, not `main`.

## 6. Admin section

- **/admin/users** — table from Postgres `users` (email, joined, #scans, last active), search/paginate.
- **/admin/metrics** — line chart of cumulative + new signups/day (SQL `date_trunc`).
- **/admin/mlops** — table of model versions (semver, trained_at, dataset size, accuracy/F1,
  `is_current` flag) + last-retrained; a "Rebuild model" action triggers the `trainer`. Read-only data otherwise.

## 7. ML / MLOps

- **Backbone:** EfficientNet-B0 (ImageNet-pretrained, CPU-friendly), fine-tune last blocks + heads.
- **Heads:** separate softmax heads for low-cardinality labels (`type`, `rarity`, `set`).
  **Card name → top-N softmax (one set, ~50–100 cards) for the MVP**; *target* is an
  embedding/retrieval head so new cards don't force a full retrain. Card number read via
  API cross-reference, not the CNN.
- **Dataset:** seed from Pokémon TCG API card images (instant labeled data) + heavy
  augmentation (rotation/skew/brightness/blur/noise) → 30–50 synthetic samples/card.
  Capture **10–20 real phone photos** as a held-out test set (synthetic-only eval lies).
  Stored as `ml/datasets/v{N}/` + `manifest.csv`.
- **Rebuild pipeline:** admin "Rebuild model" (or CLI) → one-shot `trainer` container reads
  `datasets/vN`, trains, evaluates on the real-photo test set, writes atomic
  `models/v{N}/{model.pt,labels.json,metrics.json}` and a `model_versions` row in Postgres.
- **Registry/serving:** registry = Postgres `model_versions` table; artifacts on the `models`
  volume. "Promote to production" flips `is_current`. `inference` loads current model on
  startup and via `/reload`, so promotion needs no image rebuild. (MLflow noted as the
  "if we had more" option; intentionally not used.)
- **Inference API:** `POST /predict` (multipart image) → per-attribute `{value, conf}` +
  `model_version`; then enrichment layer queries the TCG API to validate/complete the profile.
- **Metrics shown:** per-label accuracy + macro-F1, name top-1/top-3, dataset size + version,
  model version, train date, duration, epochs, git commit.

## 8. Sentinel (PR-shepherd agent)

- **Architecture:** hybrid — webhook listener (real-time `pull_request`, `*_review`,
  `check_suite`, `status`) + in-process `node-cron` sweeper (age recompute, escalating nudges,
  reconcile vs GitHub to recover missed events). Full reconcile on boot. Local webhooks via a
  `tunnel` (smee/cloudflared) sidecar; cron still works offline.
- **Stack:** TypeScript/Node, **GitHub App** via Octokit (scoped, short-lived tokens, its own
  audit identity), **Slack app + bot token** via `@slack/bolt` (interactive Block Kit
  buttons), `node-cron`, `better-sqlite3`.
- **Lifecycle:** `OPENED → AWAITING_TESTERS → IN_TESTING → CHANGES_REQUESTED → APPROVED →
  MERGING → MERGED`, plus `BLOCKED` (conflict/CI red) and `ESCALATED`.
- **Escalation by age:** 0h post + 1 random tester · 24h reminder + 2nd tester · 48h
  channel-wide · 96h ping owner · 7d recommend close. Nudges respect per-PR cooldown + daily
  per-person cap; only fire if state still warrants.
- **Random tester selection:** `roster.yaml` (Slack id ↔ GitHub login, active flag).
  Weighted-random, excludes author + already-asked, prefers least-recently-asked (fairness).
  Tracked in an `assignments` table; no response in 24h → pick another, lower weight.
- **Auto-merge policy — ALL must hold:** CI/check-suites green; ≥N approvals from a
  **designated reviewer list** (owner + trusted seniors, *not* random testers); zero
  conflicts + branch up-to-date (may auto-rebase then re-await CI); no `do-not-merge` label;
  no unresolved review threads; optional AI pre-review produced no high-severity finding.
  **Branch protection is the hard enforcer; Sentinel merges *through* the gates.** Squash
  merge, then delete branch.
- **Guardrails:** AI review is *advisory only* (plain-English diff summary + smell flags for
  non-technical reviewers) and never overrides a red gate. `PAUSE` kill-switch halts all
  merges. Escalates to owner on BLOCKED>48h, repeated CI failures, high-severity AI flag, or
  merge errors.
- **Persistence (SQLite):** `prs`, `assignments`, `reviewers`, `roster`, `events` (audit log).
- **For now:** reads Slack/GitHub creds from `.env`; stays inert until tokens are provided
  at Phase ④.

## 9. CI / DevOps

- **`review.yml`** (on `pull_request`): matrix per package — lint (ESLint/Ruff), format check,
  type-check (tsc/mypy); optional `ai-review` job comments on the PR for non-technical authors.
- **`build-tests.yml`** (on `pull_request` + push to `main`): build each Docker image with
  GHA layer cache → unit tests (vitest/pytest in images) → `smoke` job: `docker compose up -d`
  (test profile), wait for healthchecks, curl `/api/health` + a fixture-image prediction, tear down.
- **Local-as-prod:** same images both places, behavior env-driven; base compose +
  `override` (dev mounts/hot reload) + `prod` (built images, restart policies). Healthchecks
  on every service.
- **Secrets:** git-ignored `.env` (+ committed `.env.example`); CI uses GitHub Actions
  encrypted secrets.
- **Branch protection** on `main`: require PR, require `review` + `build-tests` checks green,
  require ≥1 approval, no force-push, dismiss stale approvals — the gates Sentinel relies on.

## 10. Build phases

- **① Foundation:** repo + monorepo skeleton + base `docker-compose.yml` + Caddy + `.env.example`
  + CI workflows + branch protection. Everything `docker compose up`-able (placeholder services).
- **② Product (stubbed model):** Next.js app — auth, `/scan` → result flow with a *stubbed*
  `/predict`, admin shell, demos scaffold. Running on `http://192.168.3.177`.
- **③ Real ML + MLOps:** dataset build, `trainer`, `inference` with real model, MLOps admin
  view wired to `model_versions`.
- **④ Sentinel:** full PR lifecycle, Slack integration, auto-merge through gates (owner
  provides tokens here).
- **⑤ Polish:** "wow" confidence overlay, demos contributor docs, README/onboarding.

## 11. Out of scope (now)

Other TCGs (Magic/Yu-Gi-Oh); real payments / live marketplace; mobile/PWA; real-time camera
& multi-card batch scanning; auto-retraining triggers / drift detection / canary serving;
full card catalog (thousands of names) at launch; fake/grading detection; OCR of full card
text; OAuth/email-verification/RBAC beyond user|admin; Kubernetes/cloud deploy; GPU
orchestration; MLflow; Prometheus/Grafana; i18n / A-B testing; Sentinel resolving merge
conflicts beyond auto-rebase, or acting as sole approver of substantive logic.
