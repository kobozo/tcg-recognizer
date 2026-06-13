# Phase ② Product (stubbed model) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. TDD throughout. The inference `/predict` stays the Phase ① stub — real model is Phase ③.

**Goal:** A usable web app: users register/log in, upload a card, get a card-profile result (driven by the stubbed `/predict`), see their scan history; the owner sees an admin section (users, signup chart, MLOps placeholder); contributors can add safe demo pages.

**Architecture:** Next.js App Router owns UI + API routes + data (Prisma → Postgres). Auth.js (NextAuth v5) credentials provider with a Prisma adapter. The scan route proxies the uploaded image to `inference:/predict` (stub), persists a `Scan`, and renders a result page. Admin is gated by a `role` column. Contributor pages live under `app/demos/<slug>/` behind a registry + shared layout.

**Tech Stack:** Next.js 15, Prisma 6, Postgres 16, Auth.js v5 (`next-auth@beta`), bcrypt, Tailwind (added here), vitest. All inside the existing `web` container.

**Data contract reused from Phase ①** (`inference /predict` response): each of `name|type|set|rarity|card_number` is `{value, conf}` (+ `name.candidates[]`), plus `model_version`.

---

## Task 1: Tailwind + Prisma + DB schema (data foundation)

**Files:** `apps/web/` — add Tailwind config + globals; `prisma/schema.prisma`; `lib/db.ts`; update `package.json`, `Dockerfile`; `__tests__/db-schema.test.ts`.

- [ ] **Step 1:** Add deps to `apps/web/package.json`: `@prisma/client@^6`, `next-auth@5.0.0-beta.25`, `@auth/prisma-adapter@^2`, `bcryptjs@^2.4.3`, `tailwindcss@^3.4`, `postcss`, `autoprefixer`, `zod@^3`; dev: `prisma@^6`, `@types/bcryptjs`. Add scripts: `"db:migrate": "prisma migrate deploy"`, `"db:generate": "prisma generate"`, `"postinstall": "prisma generate"`.
- [ ] **Step 2:** Create `apps/web/prisma/schema.prisma`:

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

enum Role { USER ADMIN }

model User {
  id            String   @id @default(cuid())
  email         String   @unique
  passwordHash  String
  role          Role     @default(USER)
  createdAt     DateTime @default(now())
  scans         Scan[]
  sessions      Session[]
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Scan {
  id           String   @id @default(cuid())
  userId       String
  imagePath    String
  predictions  Json
  modelVersion String
  createdAt    DateTime @default(now())
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model ModelVersion {
  id          String   @id @default(cuid())
  version     String   @unique
  metrics     Json
  datasetSize Int      @default(0)
  isCurrent   Boolean  @default(false)
  trainedAt   DateTime @default(now())
}
```

- [ ] **Step 3:** `lib/db.ts` — singleton Prisma client (avoid hot-reload connection leaks):

```ts
import { PrismaClient } from "@prisma/client";
const g = globalThis as unknown as { prisma?: PrismaClient };
export const db = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.prisma = db;
```

- [ ] **Step 4:** Tailwind: `tailwind.config.ts` (content globs `./app/**/*.{ts,tsx}`), `postcss.config.mjs`, `app/globals.css` with the three `@tailwind` directives; import `globals.css` in `app/layout.tsx`.
- [ ] **Step 5:** Update `apps/web/Dockerfile`: in `build` and `runner` stages copy `prisma/`; runner `CMD` becomes `sh -c "npx prisma migrate deploy && node server.js"` so migrations apply on boot. Ensure `prisma` is available at runtime (copy `node_modules/.prisma` + `node_modules/prisma` into runner, or run generate in build and keep standalone trace).
- [ ] **Step 6: Test** `__tests__/db-schema.test.ts`: assert `PrismaClient` instantiates and exposes `user`, `scan`, `modelVersion` delegates. Run `npm test` → PASS.
- [ ] **Step 7:** Generate the initial migration against a throwaway Postgres (in CI/container): `prisma migrate dev --name init` committed under `prisma/migrations/`.
- [ ] **Step 8:** Commit: `feat(web): prisma schema, db client, tailwind`.

---

## Task 2: Auth.js (register + login + session)

**Files:** `lib/auth.ts`, `app/api/auth/[...nextauth]/route.ts`, `app/api/register/route.ts`, `lib/validation.ts`, `middleware.ts`, tests.

- [ ] **Step 1:** `lib/validation.ts` — zod schemas: `credentialsSchema` (email, password ≥8).
- [ ] **Step 2: Test first** `__tests__/register.test.ts`: POST `/api/register` with a new email creates a user with a bcrypt hash (not plaintext) and returns 201; duplicate email returns 409; weak password returns 400. Mock `db`.
- [ ] **Step 3:** `app/api/register/route.ts`: validate with zod, `bcrypt.hash`, `db.user.create`, handle unique-violation → 409.
- [ ] **Step 4:** `lib/auth.ts`: Auth.js v5 config — Credentials provider that looks up the user and `bcrypt.compare`; Prisma adapter; JWT session strategy with `role` in token + session callback. Export `handlers, auth, signIn, signOut`.
- [ ] **Step 5:** `app/api/auth/[...nextauth]/route.ts`: `export const { GET, POST } = handlers`.
- [ ] **Step 6:** `middleware.ts`: protect `/account`, `/scan`, `/admin`; redirect unauthenticated to `/login`. `/admin/*` additionally requires `role === "ADMIN"` (else 403 page).
- [ ] **Step 7:** Run tests → PASS. Commit: `feat(web): auth.js credentials + register`.

---

## Task 3: Auth pages + nav

**Files:** `app/login/page.tsx`, `app/register/page.tsx`, `components/SiteHeader.tsx`, update `app/layout.tsx`, `app/page.tsx`.

- [ ] **Step 1:** `register/page.tsx` + `login/page.tsx`: client forms (email/password) calling `/api/register` then `signIn`. Tailwind-styled, accessible labels, inline error states.
- [ ] **Step 2:** `SiteHeader.tsx`: brand + nav (Home, Scan, My scans, Admin if role=ADMIN, Login/Logout). Server component reading `auth()`.
- [ ] **Step 3:** Landing page CTA → `/scan`. Commit: `feat(web): auth pages + site header`.

---

## Task 4: Scan flow + result page

**Files:** `app/scan/page.tsx`, `app/api/scan/route.ts`, `app/scan/[id]/page.tsx`, `components/CardProfile.tsx`, `components/ConfidenceBar.tsx`, `lib/enrich.ts`, tests.

- [ ] **Step 1: Test first** `__tests__/scan-route.test.ts`: POST `/api/scan` (multipart with an image) — authenticated — calls `predictCard` (mock `lib/inference`), persists a `Scan` (mock `db`), returns `{ id }`; unauthenticated → 401; non-image → 400.
- [ ] **Step 2:** `app/api/scan/route.ts`: require session; read multipart `image`; save bytes to a mounted volume path (`/app/uploads/<cuid>.jpg` — add an `uploads` volume in compose) and record `imagePath`; call `predictCard`; optionally `enrichCard` (Task: `lib/enrich.ts` queries Pokémon TCG API by predicted name, best-effort, returns `{hp, attacks, priceIndicator}` or null); `db.scan.create`; return `{ id }`.
- [ ] **Step 3:** `lib/enrich.ts`: fetch `https://api.pokemontcg.io/v2/cards?q=name:"<name>"` (header `X-Api-Key` if `POKEMON_TCG_API_KEY` set); map first hit; swallow errors → null (enrichment is best-effort, never blocks a result).
- [ ] **Step 4:** `ConfidenceBar.tsx`: green ≥0.85 / amber ≥0.6 / red <0.6. `CardProfile.tsx`: two columns — uploaded image + predicted fields as chips with confidence bars; a distinct "Verified from Pokémon TCG API" block for enrichment; low-confidence (<0.6 top) shows "Did you mean?" candidates.
- [ ] **Step 5:** `app/scan/page.tsx`: upload form (file input + preview) POSTing to `/api/scan`, then routes to `/scan/[id]`. `app/scan/[id]/page.tsx`: server component loads the `Scan` (owner-only), renders `CardProfile`.
- [ ] **Step 6:** Run tests → PASS. Commit: `feat(web): scan flow + card profile result`.

---

## Task 5: Admin section

**Files:** `app/admin/layout.tsx` (role guard), `app/admin/users/page.tsx`, `app/admin/metrics/page.tsx`, `app/admin/mlops/page.tsx`, `components/SignupChart.tsx`, `lib/admin.ts`, tests.

- [ ] **Step 1: Test first** `__tests__/admin-guard.test.ts`: a non-admin session hitting an admin server action/query is rejected; admin passes. (Unit-test the `requireAdmin()` helper in `lib/admin.ts`.)
- [ ] **Step 2:** `lib/admin.ts`: `requireAdmin()` → throws/redirects unless `auth()` role is ADMIN. Query helpers: `listUsers()`, `signupsByDay()` (Prisma `groupBy`/raw `date_trunc`), `listModelVersions()`.
- [ ] **Step 3:** `/admin/users`: table (email, joined, #scans). `/admin/metrics`: `SignupChart` (lightweight SVG/`<canvas>` or a tiny chart lib — prefer a dependency-free inline SVG line chart) of cumulative + daily signups. `/admin/mlops`: table of `ModelVersion` rows (version, trainedAt, datasetSize, accuracy/F1 from `metrics`, isCurrent) — empty-state "No models trained yet" until Phase ③.
- [ ] **Step 4:** Seed script `prisma/seed.ts` creating an admin user from `ADMIN_EMAIL`/`ADMIN_PASSWORD` env (add to `.env.example`). Run via `prisma db seed`.
- [ ] **Step 5:** Run tests → PASS. Commit: `feat(web): admin users/metrics/mlops + admin seed`.

---

## Task 6: Contributor demos scaffold

**Files:** `app/demos/registry.ts`, `app/demos/page.tsx`, `app/demos/[slug]/` (dynamic not needed — use real folders), `components/DemoLayout.tsx`, one sample `app/demos/hello/page.tsx`, `CODEOWNERS`, `.github/pull_request_template.md`, `docs/CONTRIBUTING.md`.

- [ ] **Step 1:** `registry.ts`: `export const demos = [{slug, title, description, author}]` array; one `hello` entry.
- [ ] **Step 2:** `DemoLayout.tsx`: wraps content with site header/footer + a "community demo" banner so contributor pages can't break global chrome.
- [ ] **Step 3:** `demos/page.tsx`: auto-list from `registry`. `demos/hello/page.tsx`: sample using `DemoLayout`.
- [ ] **Step 4:** `CODEOWNERS` (owner owns root + CI; demos folder open), PR template (checklist: tested locally?, screenshot?, registry updated?), `CONTRIBUTING.md` explaining the "add a folder + registry line" flow for non-technical + AI contributors.
- [ ] **Step 5:** Commit: `feat(web): demos scaffold + contributor docs`.

---

## Task 7: Wire compose, extend smoke + CI

**Files:** `docker-compose.yml` (uploads volume, DB env to web, ADMIN_* env), `scripts/smoke.sh`, `apps/web/__tests__` (vitest), `.github/workflows/build-tests.yml`.

- [ ] **Step 1:** Add `uploads` named volume mounted at `/app/uploads` on `web`; ensure `DATABASE_URL` + `ADMIN_EMAIL`/`ADMIN_PASSWORD` reach `web` via `.env`.
- [ ] **Step 2:** Extend `scripts/smoke.sh`: after health, register a user via `/api/register`, log in, POST a fixture image to `/api/scan`, assert a result `id` comes back and `/scan/<id>` returns 200. Add a tiny fixture image under `scripts/fixtures/card.jpg`.
- [ ] **Step 3:** `build-tests.yml` already runs `npm test` + smoke; confirm the new vitest suites + smoke steps run. Add a Postgres service or rely on the composed `db` (smoke uses compose, so `db` is present).
- [ ] **Step 4:** Run `bash scripts/smoke.sh` → expect end-to-end PASS (register → scan → result). Commit: `test: e2e scan smoke + uploads volume`.

---

## Self-Review notes

- **Spec coverage:** auth/accounts ✔, scan→result with confidence + enrichment ✔, admin users/metrics/mlops ✔, demos scaffold + contributor safety (CODEOWNERS/template/layout) ✔, stubbed predict reused ✔, Docker/CI wiring ✔. MLOps table is a placeholder until Phase ③ populates `ModelVersion` (intentional).
- **Type consistency:** `predictions` JSON stored on `Scan` matches the Phase ① `/predict` contract; `CardProfile` reads the same shape; `ModelVersion.metrics` JSON is the same object the Phase ③ trainer will write.
- **Risk:** Auth.js v5 is beta — pin the exact version; if its API shifts, the implementer task may need adjustment (flag as DONE_WITH_CONCERNS if so).
