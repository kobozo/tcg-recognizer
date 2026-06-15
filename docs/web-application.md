# Web Application

This document describes the user-facing web application of the TCG Card Recognizer
(`apps/web`): what it does, how it is built, and — most importantly — *why* each
technology and pattern was chosen. Every claim is grounded in the source; file
paths are given inline so the implementation can be verified directly.

The web app is the product surface for the whole project: a collector points a
camera at a trading card, the app recognizes it, enriches it with market data,
and files it into their collection. It also hosts the human-in-the-loop feedback
loop that feeds the ML pipeline, and an admin/MLOps console.

---

## 1. Stack & why

The dependency list lives in `apps/web/package.json`. Each choice maps to a
concrete need.

### Next.js 15 (App Router) + React 19 + TypeScript

`next@15.1.3`, `react@19.0.0` (`apps/web/package.json`). The App Router (the
`apps/web/app/**` tree) was chosen because most pages are *data pages* that read
the database and external TCG APIs and render server-side — exactly what React
**Server Components** are for.

Concretely, server components let pages query Postgres directly with no client
data-fetching layer and no API round-trip:

- `apps/web/app/collection/page.tsx` calls `auth()` and `db.scan.findMany(...)`
  in the component body, aggregates set-completion server-side, then streams HTML.
- `apps/web/app/sets/[game]/page.tsx` and `.../[id]/page.tsx` `await` the TCG
  provider on the server, so external API keys/latency never reach the browser.
- Interactivity is opted into explicitly with `"use client"` only where it is
  needed: `CameraScanner`, `CollectionView`, `FeedbackControl`, the
  assistant page, and the auth forms.

Why this split matters: the camera, the search/filter UI, and the chat box are
genuinely interactive and must run in the browser; everything else (collection
totals, set grids, admin tables) is read-mostly and renders faster and more
securely on the server. The App Router makes that boundary a per-file decision.

Other Next.js features used for real reasons:
- `apps/web/next.config.ts` sets `output: "standalone"` so the production Docker
  image ships a self-contained server (small image, no `node_modules` copy).
- Route segment caching: set pages declare `export const revalidate = 86400`
  (`apps/web/app/sets/[game]/page.tsx`) and provider `fetch` calls pass
  `next: { revalidate: 86400 }` — official set catalogues change rarely, so they
  are cached for a day instead of hammering the upstream API on every view.
- `generateMetadata` produces per-set page titles
  (`apps/web/app/sets/[game]/[id]/page.tsx`).

TypeScript is used throughout (`tsconfig.json`, `typecheck` script) so the shapes
flowing between the recognizer, the DB JSON column, and the UI are checked. The
prediction payload has a single source of truth in `apps/web/lib/types.ts`
(`CardPredictions`, `Prediction`, `Enrichment`), and Auth.js's session/JWT types
are augmented so `session.user.id` and `session.user.role` are typed everywhere
(`apps/web/lib/auth.ts`).

### Auth.js v5 — credentials provider + JWT sessions

`next-auth@5.0.0-beta.25` with `@auth/prisma-adapter` (`apps/web/lib/auth.ts`).

- **Credentials provider** (email + password) was chosen over OAuth because this
  is a self-hosted student project with no external identity provider dependency;
  accounts are owned entirely by the app. `authorize()` validates input with Zod,
  normalizes the email, looks the user up via Prisma, and verifies the password
  with `bcrypt.compare` against the stored `passwordHash`
  (`apps/web/lib/auth.ts:39-52`).
- **JWT session strategy** (`session: { strategy: "jwt" }`) is deliberate: it
  pairs with the credentials provider (which has no OAuth account record) and,
  crucially, lets the Next.js **middleware** read the session at the edge without
  a database hit on every request. The `jwt` callback stamps `id` and `role` into
  the token; the `session` callback copies them onto `session.user`
  (`apps/web/lib/auth.ts:55-68`), so role checks are available cheaply everywhere.
- `bcryptjs` (pure-JS bcrypt) is used for hashing both at registration
  (`apps/web/app/api/register/route.ts`, cost factor 10) and verification, so no
  native build step is required in the container.

### Prisma 6 + PostgreSQL — type-safe ORM

`@prisma/client@^6`, `prisma@^6`, `provider = "postgresql"`
(`apps/web/package.json`, `apps/web/prisma/schema.prisma`).

- **Postgres** is the right database here for two reasons beyond relational
  storage: the project also uses Postgres + `pgvector` for the recognition index
  (see the inference service), so one engine serves the whole system; and the
  admin analytics use Postgres-specific SQL — daily signup buckets via
  `date_trunc` and JSON-path aggregation over the `predictions` column
  (`apps/web/lib/admin.ts:27-65`).
- **Prisma** gives a typed schema and migrations. The `Scan.predictions` field is
  a `Json` column (`apps/web/prisma/schema.prisma:38`), which is exactly right for
  the recognizer's variable, evolving output — it is stored verbatim and typed at
  the application boundary via `CardPredictions`, rather than forced into rigid
  columns.
- **Single client instance.** `apps/web/lib/db.ts` memoizes the `PrismaClient` on
  `globalThis` in non-production to avoid exhausting connections under Next.js dev
  hot-reload — the standard Prisma + Next pattern.

Schema highlights (`apps/web/prisma/schema.prisma`): `User` (with a `Role` enum
`USER`/`ADMIN`), `Scan` (per-user, `game`, `imagePath`, `predictions` JSON,
`modelVersion`, indexed on `[userId, createdAt]`), `Feedback` (the
human-in-the-loop label, `correct`/`correctedName`, one-to-one with a scan),
`ModelVersion` (MLOps registry: `version`, `metrics` JSON, `isCurrent`). Both
`Scan` and `Feedback` cascade-delete with the owning `User`.

### Tailwind CSS — design system + OLED-friendly dark theme

`tailwindcss@^3.4` with a custom theme (`apps/web/tailwind.config.ts`,
`apps/web/app/globals.css`). Tailwind was chosen so the visual system lives in one
config rather than scattered CSS: the palette (deep navy `background #0B1220`,
`surface`, `elevated`, emerald `primary`, amber `accent`), radii, the `glow`/`card`
shadows, and the `fade-up`/`scanline` animations are all declared once and reused.
The theme is dark-first (`color-scheme: dark`), which suits a camera/scanning app.

### lucide-react

`lucide-react@^0.469.0` — a consistent, tree-shakeable SVG icon set used across
every page (camera, scan, collection, admin) so iconography is uniform and ships
no icon-font weight.

### Zod

`zod@^3` — runtime validation at the trust boundary. One schema,
`credentialsSchema` (`apps/web/lib/validation.ts`), is reused by both the login
`authorize()` and the registration route, guaranteeing email/password rules are
identical on both paths and that TypeScript types are inferred from the schema
(`z.infer`).

---

## 2. Pages & flows

Layout: `apps/web/app/layout.tsx` wraps every page with `SiteHeader` and
`SiteFooter` and loads the Inter font via `next/font`. The header
(`apps/web/components/SiteHeader.tsx`) is a server component that reads the
session and passes `isAuthed`/`isAdmin`/`email` plus a server-action
`logoutAction` down to the client `HeaderNav` — so the nav shows the right links
(My collection, Assistant, Admin) without a client session fetch.

### Home (`apps/web/app/page.tsx`) — server component

Marketing landing page. Reads the session server-side and, if the visitor is
already signed in, `redirect("/collection")` — collectors go straight to the heart
of the app. Otherwise it shows the value proposition and CTAs to register/scan.

### Login & Register (`apps/web/app/login/page.tsx`, `.../register/page.tsx`) — client components

Both are `"use client"` forms. Login calls `signIn("credentials", … redirect:
false)` then navigates to the `callbackUrl` query param (defaults to `/scan`); it
maps any error to a generic "Invalid email or password." (no user enumeration).
Register POSTs to `/api/register`, and on `201` immediately signs the user in and
redirects to `/scan`; it maps `400`/`409` to friendly messages. Login wraps its
form in `<Suspense>` because it reads `useSearchParams()`.

### Scan flow (camera/upload)

`apps/web/app/scan/page.tsx` is a server component that lists the
deployment-enabled games and renders the `CameraScanner` client component. The
scanner (`apps/web/components/CameraScanner.tsx`) is the most involved client
piece and drives a small state machine (`idle → requesting → streaming → captured
→ submitting`):

1. **Capture or upload.** It requests the rear camera via
   `getUserMedia({ facingMode: "environment" })`, draws a card-frame guide with an
   animated scanline overlay, and captures a frame to a canvas as JPEG (quality
   0.92). It gracefully degrades: if `getUserMedia` is unavailable or the context
   is not secure (HTTPS), it disables the camera and offers a file upload instead;
   `NotAllowedError` produces a clear permission message. Object URLs are revoked
   on retake/unmount to avoid leaks.
2. **Optional on-device recognition.** A "Recognize on device (private)" toggle,
   when on, computes a descriptor in the browser (`embedOnDevice` →
   `apps/web/lib/clientEmbedding.ts`) and sends only the vector — the photo's
   bytes still upload for storage, but the framing here is privacy/offload. (See
   the in-code note: the learned DINOv2 embedder runs server-side today; the
   browser port is a documented follow-up.)
3. **Submit.** It POSTs `multipart/form-data` (`image`, `game`, optional
   `embedding`) to `/api/scan`, handles `401` (session expired) and other errors
   inline, and on success `router.push(\`/scan/${id}\`)`.

### Scan result + feedback (`apps/web/app/scan/[id]/page.tsx`) — server component

Loads the scan by id, enforces ownership (`scan.userId !== session.user.id →
notFound()`), splits the stored JSON into `predictions` + `enrichment`, and
renders:

- `CardProfile` (`apps/web/components/CardProfile.tsx`): the uploaded image (via
  the auth-gated `/api/uploads/[file]` route) next to predicted attributes (name,
  type, set, rarity, card number), each with a `ConfidenceBar`. When the name's
  confidence is `< 0.6`, it surfaces a "Did you mean?" candidate list; if a VLM
  read is present it shows the "AI read"; if enrichment is present it shows
  "Verified market data" (estimated value, HP, attacks).
- `FeedbackControl` (`apps/web/components/FeedbackControl.tsx`): the
  human-in-the-loop control. "Looks right" confirms the prediction; "Not quite"
  lets the user pick from candidates or type the correct name. It POSTs to
  `/api/feedback`. The UI copy makes the intent explicit: "confirmations train the
  model on real photos."

### Collection (`apps/web/app/collection/page.tsx`) — server component

The product's core view. It loads all of the user's scans and computes, entirely
server-side:

- **Totals**: estimated value, cards owned, distinct sets, distinct games. Value
  is bucketed *per currency* (`formatTotals`, `apps/web/lib/format.ts`) so a EUR
  total is never meaninglessly summed with a USD one.
- **Set completion**: for each game present it fetches official set totals from
  the provider and renders progress bars (owned / total, %). Ownership is counted
  by a **distinct-card identity** (`name|card_number`, falling back to the scan id
  when those are missing), so re-scanning the same card does not inflate
  ownership or value (`apps/web/app/collection/page.tsx:84-116`).
- **Grid**: hands the card list to `CollectionView`
  (`apps/web/components/CollectionView.tsx`), a client component providing search
  and game/set/rarity filters (the set/rarity options narrow to the chosen game).

Empty state prompts the user to scan their first card.

### Sets hub — multi-TCG (`apps/web/app/sets/**`) — server components

- `/sets` lists every known game (`listGames()`), linking enabled ones and showing
  "Coming soon" for the rest.
- `/sets/[game]` lists that game's sets from its provider, with per-set "owned"
  badges for the signed-in user; if a game is built but disabled it explains it can
  be switched on via `ENABLED_GAMES`. If the upstream API is unreachable it shows a
  friendly "couldn't reach the API" notice (because providers return `[]` on error,
  never throw).
- `/sets/[game]/[id]` shows the full set as a card grid, ringing/un-graying the
  cards the user owns and showing a completion percentage.

### Assistant (`apps/web/app/assistant/page.tsx`) — client component

A chat UI (suggested prompts, turn list, sticky composer) that POSTs questions to
`/api/assistant`. The server side (`apps/web/lib/assistant.ts`) builds a compact,
token-bounded **text summary of the user's own collection** (totals, per-set
completion with values, up to 60 recent cards) and sends it as system context to
an LLM via a provider router (`apps/web/lib/llm/router.ts`), instructing the model
to answer only from that data and to price in EUR (Belgium). If no LLM backend is
configured, it returns an inert "not configured" message rather than erroring.

### Admin / MLOps (`apps/web/app/admin/**`) — server components

`/admin` redirects to `/admin/users`. The admin layout
(`apps/web/app/admin/layout.tsx`) calls `requireAdmin()` (`apps/web/lib/admin.ts`)
which re-checks the role server-side (defense in depth on top of the middleware)
and renders the Users / Metrics / MLOps tabs.

- **Users** (`apps/web/app/admin/users/page.tsx`): all users with join date, scan
  count, and role.
- **Metrics** (`apps/web/app/admin/metrics/page.tsx`): signups over time, computed
  with a raw `date_trunc` query, charted by `SignupChart`.
- **MLOps** (`apps/web/app/admin/mlops/page.tsx`): a recognition-health panel
  (total scans, average confidence, low-confidence rate, feedback/corrections, a
  "consider retraining" flag) plus the trained `ModelVersion` registry with
  `recall@1` and deep links into MLflow. The health stats come from JSON-path SQL
  over the `predictions` column (`recognitionHealth`, `apps/web/lib/admin.ts`),
  tying the live app data back to the ML lifecycle.

---

## 3. API routes (`apps/web/app/api/**`)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/auth/[...nextauth]` | GET/POST | n/a | Auth.js handlers (`apps/web/app/api/auth/[...nextauth]/route.ts`) |
| `/api/register` | POST | public | Create account |
| `/api/scan` | POST | required | Recognize + store a scan |
| `/api/feedback` | POST | required | Record human-in-the-loop label |
| `/api/assistant` | POST | required | Collection Q&A |
| `/api/uploads/[file]` | GET | required + ownership | Serve an uploaded image |
| `/api/health` | GET | public | Liveness probe |

### Two-layer auth enforcement

1. **Middleware** (`apps/web/middleware.ts`) wraps the matched page routes
   (`/collection`, `/scan`, `/admin`, `/assistant`) with `auth(...)`: unauthenticated
   requests are redirected to `/login?callbackUrl=…`, and `/admin/*` additionally
   requires `role === "ADMIN"` (else redirect home). This runs at the edge using the
   JWT, so it is cheap.
2. **Per-route checks.** Because the middleware matcher does **not** cover
   `/api/*`, every protected API handler independently calls `await auth()` and
   returns `401` when there is no session (`/api/scan`, `/api/feedback`,
   `/api/assistant`, `/api/uploads/[file]`). Server pages and admin queries also
   re-check (`requireAdmin`, ownership in `scan/[id]`). The result is layered
   defense rather than a single gate.

### `/api/scan` — recognition pipeline (`apps/web/app/api/scan/route.ts`)

Auth → parse `multipart/form-data` → validate the file is a non-empty image →
resolve `game` (rejecting any game not in `ENABLED_GAMES`, falling back to
Pokémon) → optionally accept a client-computed `embedding` (validated to be a
numeric array, ignored if malformed). It persists the bytes to the uploads volume
under a random UUID filename, then calls the recognition pipeline:

- `predictCard` → the inference microservice (`apps/web/lib/inference.ts`, 15s
  timeout). On failure it removes the orphaned upload and returns `502` rather than
  an unhandled `500`. It also **defensively validates** the `unknown` response
  shape (`name.value`, `name.conf`, `model_version`) before trusting it.
- Optional OCR text channel (Postgres + pgvector) and optional VLM
  disambiguation (only when confidence `< 0.6`) fold in extra candidates — both
  opt-in and best-effort.
- `enrichCard` adds market data (best-effort, never blocks).

Finally it stores a `Scan` row with `{ ...predictions, enrichment }` in the JSON
column and returns `{ id }` (`201`).

### `/api/feedback` (`apps/web/app/api/feedback/route.ts`)

Auth → JSON parse → **ownership check** (`scan.userId !== session.user.id → 404`)
→ derive `predictedName` from the stored scan and `correctedName` from the body
(or the prediction itself when the user confirmed) → `db.feedback.upsert` keyed on
`scanId`. This is the active-learning signal the trainer later folds back into the
index.

### `/api/assistant` (`apps/web/app/api/assistant/route.ts`)

Auth → validate question (non-empty, ≤ 2000 chars) → `askAssistant(userId, …)`.
A model/config problem is returned as `200 { error }` (not a 5xx) so the chat UI
can show it inline — it is not a server fault.

### `/api/uploads/[file]` — IDOR protection (`apps/web/app/api/uploads/[file]/route.ts`)

This route is the model citizen for access control:

- **Auth required** (`401` otherwise).
- **Path-traversal guard**: `path.basename(file)` strips any `../`, so only a bare
  filename inside `UPLOADS_DIR` can ever be read.
- **Ownership / IDOR guard**: it serves the file only if a `Scan` owned by the
  *session user* has that exact `imagePath` (`db.scan.findFirst({ where: { userId,
  imagePath } })`). A valid filename belonging to another user returns `404`, not
  the image. Responses are marked `Cache-Control: private`.

### `/api/register` (`apps/web/app/api/register/route.ts`)

Public. Validates with `credentialsSchema`, hashes with bcrypt (cost 10), creates
the user. A Prisma `P2002` unique-constraint violation is mapped to `409 "Email
already registered"`.

### `/api/health` (`apps/web/app/api/health/route.ts`)

Returns `{ status: "ok", service: "web" }` for container/orchestrator probes.

---

## 4. Multi-TCG abstraction (`apps/web/lib/games/**`)

The app is built around a clean game-provider interface so a second (or third)
trading-card game is a data-source plug-in, not a rewrite.

- **Interface** (`apps/web/lib/games/types.ts`): `GameProvider` declares
  `listSets()`, `getSet(id)`, `getSetCards(setId)`, and `enrich(name)` returning
  the shared `Enrichment` type. Common helpers live here too: `normalizeSetName`
  (loose matching of model-predicted set names against catalogue names) and
  `preferredCurrency()` (EUR by default — the deployment is in Belgium — overridable
  via `PREFERRED_CURRENCY`).
- **Implementations**: `pokemon.ts` wraps the Pokémon TCG API (optional
  `POKEMON_TCG_API_KEY`); `magic.ts` wraps Scryfall (no key). Each maps the
  upstream shape to the shared `GameSet`/`GameCard` types and resolves a price.
- **Registry / feature flag** (`apps/web/lib/games/index.ts`): `GAMES` holds the
  metadata + provider for each game; `ENABLED_GAMES` (env) controls which are
  switched on for a deployment without code changes (default `pokemon`).
  `isGameEnabled`, `listGames`, `listEnabledGames`, and `getProvider` are the
  accessors the pages and the scan route use. This is why the proposal's Pokémon
  concentration coexists with a genuinely multi-TCG architecture: Magic is fully
  implemented and can be enabled with one env var.

### Enrichment + EUR pricing

`enrichCard(name, game)` (`apps/web/lib/enrich.ts`) delegates to the game's
provider and **never throws** (returns `null` on any error) so enrichment can't
break a scan. Pricing prefers the deployment currency: for Pokémon it reads
Cardmarket `trendPrice`/`averageSellPrice` (EUR) before TCGplayer market (USD); for
Magic it reads Scryfall `eur` before `usd` (`apps/web/lib/games/pokemon.ts`,
`magic.ts`). Display is locale-formatted by `formatMoney` and per-currency totals
by `formatTotals` (`apps/web/lib/format.ts`).

---

## 5. Security & correctness

- **Authentication everywhere it matters.** Middleware gates the protected page
  routes (and the admin role); every protected API route re-checks `auth()`; admin
  pages additionally call `requireAdmin()`. Defense in depth, not a single point of
  failure (`apps/web/middleware.ts`, `apps/web/lib/admin.ts`, the API routes).
- **Ownership / IDOR protection.** Scan detail, feedback, and especially the
  uploads route all verify the resource belongs to the session user before acting
  or returning data; the uploads route also blocks path traversal with
  `path.basename` (`apps/web/app/api/uploads/[file]/route.ts`,
  `apps/web/app/scan/[id]/page.tsx`, `apps/web/app/api/feedback/route.ts`).
- **Email normalization.** `credentialsSchema` trims and lowercases the email
  *before* `.email()` so signup and login always agree on identity and stored
  emails are canonical (`apps/web/lib/validation.ts`); the credentials `authorize`
  also lowercases/trims defensively (`apps/web/lib/auth.ts`).
- **Password hygiene.** Minimum 8 chars (Zod), bcrypt hashing at cost 10, and
  login errors are deliberately generic to avoid user enumeration.
- **Input validation at the boundary.** Bodies are JSON-parsed in `try/catch`
  (→ `400`), files are checked for type/size, the question length is capped, and
  the recognizer's `unknown` response is shape-validated before use.
- **Best-effort / never-throw external calls.** Every outbound call that isn't
  essential to correctness degrades instead of failing: game providers return
  `[]`/`null` on error and use bounded `AbortSignal.timeout(...)`; enrichment
  returns `null`; the assistant returns an inline error string; the inference call
  cleans up its upload and returns `502` on failure. The UI never shows an
  unhandled crash for a flaky upstream.

---

## 6. Design system

The visual approach is a **dark-first, OLED-friendly** aesthetic centered on a
deep navy canvas with frosted "glass" surfaces and an emerald/amber accent pair —
fitting for a camera/scanning product.

- **Tokens** in `apps/web/tailwind.config.ts`: semantic colors (`background`,
  `surface`, `elevated`, `border`, `foreground`, `muted`, `primary`, `accent`,
  `destructive`, `ring`), rounded radii, and custom shadows (`glow`,
  `glow-accent`, `card`).
- **Global styling** in `apps/web/app/globals.css`: `color-scheme: dark`, soft
  radial background glows, a custom focus-visible ring (accessibility), a themed
  scrollbar, a `.surface-panel` glass utility, a `.text-gradient` headline
  treatment, and a `prefers-reduced-motion` override that disables animations.
- **Motion**: the `fade-up` page-entrance and the `scanline` animation that sweeps
  the camera frame guide (`tailwind.config.ts` keyframes; used in
  `CameraScanner`).
- **Primitives** in `apps/web/components/ui/**` (`Button`, `Card`, `Input`,
  `Badge`, `Container`) give every page consistent variants/sizes. `Button`
  exposes a `buttonVariants()` helper so `<Link>`s can adopt button styling without
  wrapping a `<button>`.
- **Iconography**: `lucide-react` throughout; **typography**: Inter via
  `next/font` (`apps/web/app/layout.tsx`).
- **Responsiveness & a11y**: mobile-first layouts with a collapsible mobile nav
  (`HeaderNav`), `aria-*` labels on interactive controls, `role="alert"` on form
  errors, and visible focus rings.
