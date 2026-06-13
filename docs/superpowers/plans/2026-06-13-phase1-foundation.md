# Phase ① Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `docker compose up`-able monorepo skeleton — all services build and report healthy through a Caddy ingress on the LAN — plus GitHub Actions CI and branch protection, so later phases build on a verified base.

**Architecture:** One Caddy reverse proxy fronts a minimal Next.js `web` app; `web` talks to Postgres `db` and proxies card predictions to a FastAPI `inference` service (stubbed `/predict` for now); a minimal `sentinel` Node service runs inert. Everything is defined in a base `docker-compose.yml` with dev (`override`) and prod overlays. CI builds every image, runs unit tests, and smoke-tests the composed stack.

**Tech Stack:** Docker Compose v5, Caddy 2, Next.js 15 (App Router, TS), FastAPI + Uvicorn (Python 3.12), Node 22 (sentinel), Postgres 16, GitHub Actions.

---

## File Structure

```
docker-compose.yml              base stack: proxy, web, inference, db, sentinel
docker-compose.override.yml     local dev: source mounts + hot reload (auto-applied)
docker-compose.prod.yml         built images, restart policies, no mounts
Caddyfile                       LAN ingress → web; /api stays in web; inference internal
.env.example                    placeholder env for all services
scripts/smoke.sh                compose up + curl health endpoints + teardown
apps/web/
  Dockerfile  .dockerignore  package.json  next.config.ts  tsconfig.json
  app/layout.tsx  app/page.tsx  app/api/health/route.ts
  lib/inference.ts            server-side client to the inference service
  __tests__/health.test.ts    unit test for the health route logic
services/inference/
  Dockerfile  requirements.txt  app/main.py  app/test_main.py
services/sentinel/
  Dockerfile  package.json  tsconfig.json  src/index.ts
ml/models/.gitkeep  ml/datasets/.gitkeep
.github/workflows/review.yml          lint/format/type-check
.github/workflows/build-tests.yml     build images → unit tests → compose smoke
```

**Verification target for the whole phase:** `bash scripts/smoke.sh` exits 0 — Caddy serves the landing page, `http://<host>/api/health` returns `{"status":"ok"}`, and that route's upstream call to `inference /predict` (stub) succeeds.

---

## Task 1: Env + ML placeholder dirs

**Files:** Create `.env.example`, `ml/models/.gitkeep`, `ml/datasets/.gitkeep`

- [ ] **Step 1:** Create `.env.example`:

```dotenv
# --- Postgres ---
POSTGRES_USER=tcg
POSTGRES_PASSWORD=change-me-locally
POSTGRES_DB=tcg
DATABASE_URL=postgresql://tcg:change-me-locally@db:5432/tcg

# --- Web ---
NODE_ENV=development
AUTH_SECRET=generate-with-openssl-rand-base64-32
INFERENCE_URL=http://inference:8001
NEXT_PUBLIC_SITE_NAME=TCG Card Recognizer

# --- Inference / enrichment ---
POKEMON_TCG_API_KEY=
MODEL_DIR=/models

# --- Sentinel (inert until provided at Phase 4) ---
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=
SLACK_BOT_TOKEN=
SLACK_APP_TOKEN=
SENTINEL_REPO=kobozo/tcg-recognizer
SENTINEL_PAUSED=true

# --- LAN binding (owner works remotely) ---
PUBLIC_HOST=192.168.3.177
```

- [ ] **Step 2:** Create empty `ml/models/.gitkeep` and `ml/datasets/.gitkeep`.
- [ ] **Step 3:** Commit: `git add -A && git commit -m "chore: env template + ml dirs"`

---

## Task 2: Inference service (FastAPI, stubbed predict) — TDD

**Files:** Create `services/inference/{Dockerfile,requirements.txt,app/main.py,app/test_main.py}`

- [ ] **Step 1: Write the failing test** `services/inference/app/test_main.py`:

```python
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"

def test_predict_stub_shape():
    files = {"image": ("card.jpg", b"fakebytes", "image/jpeg")}
    r = client.post("/predict", files=files)
    assert r.status_code == 200
    body = r.json()
    for key in ("name", "type", "set", "rarity", "card_number"):
        assert key in body and "value" in body[key] and "conf" in body[key]
    assert "model_version" in body
```

- [ ] **Step 2:** `requirements.txt`:

```
fastapi==0.115.6
uvicorn[standard]==0.34.0
python-multipart==0.0.20
pytest==8.3.4
httpx==0.28.1
```

- [ ] **Step 3:** Implement `app/main.py`:

```python
from fastapi import FastAPI, UploadFile, File

app = FastAPI(title="TCG Inference (stub)")
MODEL_VERSION = "stub-0"

@app.get("/health")
def health():
    return {"status": "ok", "model_version": MODEL_VERSION}

@app.get("/model")
def model():
    return {"version": MODEL_VERSION, "metrics": {}, "is_current": True}

@app.post("/predict")
async def predict(image: UploadFile = File(...)):
    await image.read()
    def field(value, conf):
        return {"value": value, "conf": conf}
    # Stubbed prediction until Phase 3 swaps in the real model.
    return {
        "name": {"candidates": [field("Charizard", 0.93)], **field("Charizard", 0.93)},
        "type": field("Fire", 0.97),
        "set": field("Base", 0.74),
        "rarity": field("Rare Holo", 0.81),
        "card_number": field("4/102", 0.66),
        "model_version": MODEL_VERSION,
    }
```

- [ ] **Step 4: Run test** `cd services/inference && pip install -r requirements.txt && python -m pytest -q` → Expected: PASS (run inside CI/container; host has no pip — see Step 6).
- [ ] **Step 5:** `Dockerfile`:

```dockerfile
FROM python:3.12-slim AS base
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
EXPOSE 8001
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8001/health').status==200 else 1)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
```

- [ ] **Step 6:** Verify in container: `docker build -t tcg-inference services/inference && docker run --rm tcg-inference python -m pytest -q` → Expected: PASS.
- [ ] **Step 7:** Commit: `git add services/inference && git commit -m "feat(inference): FastAPI service with stubbed /predict"`

---

## Task 3: Web app (Next.js) health route — TDD

**Files:** Create `apps/web/{Dockerfile,.dockerignore,package.json,next.config.ts,tsconfig.json}`, `apps/web/app/{layout.tsx,page.tsx,api/health/route.ts}`, `apps/web/lib/inference.ts`, `apps/web/__tests__/health.test.ts`

- [ ] **Step 1:** `package.json` (Next 15 + vitest):

```json
{
  "name": "web",
  "private": true,
  "scripts": {
    "dev": "next dev -H 0.0.0.0 -p 3000",
    "build": "next build",
    "start": "next start -H 0.0.0.0 -p 3000",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": { "next": "15.1.3", "react": "19.0.0", "react-dom": "19.0.0" },
  "devDependencies": {
    "typescript": "5.7.2", "@types/node": "22.10.2", "@types/react": "19.0.2",
    "vitest": "2.1.8", "eslint": "9.17.0", "eslint-config-next": "15.1.3"
  }
}
```

- [ ] **Step 2:** `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022", "lib": ["dom","dom.iterable","esnext"], "allowJs": true,
    "skipLibCheck": true, "strict": true, "noEmit": true, "esModuleInterop": true,
    "module": "esnext", "moduleResolution": "bundler", "resolveJsonModule": true,
    "isolatedModules": true, "jsx": "preserve", "incremental": true,
    "plugins": [{ "name": "next" }], "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3:** `next.config.ts`:

```ts
import type { NextConfig } from "next";
const nextConfig: NextConfig = { output: "standalone" };
export default nextConfig;
```

- [ ] **Step 4: Write failing test** `apps/web/__tests__/health.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { GET } from "../app/api/health/route";

describe("GET /api/health", () => {
  it("returns ok", async () => {
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
  });
});
```

- [ ] **Step 5:** Implement `app/api/health/route.ts`:

```ts
import { NextResponse } from "next/server";
export async function GET() {
  return NextResponse.json({ status: "ok", service: "web" });
}
```

- [ ] **Step 6:** `lib/inference.ts` (server-side client used in later phases):

```ts
const INFERENCE_URL = process.env.INFERENCE_URL ?? "http://inference:8001";
export async function predictCard(image: Blob): Promise<unknown> {
  const form = new FormData();
  form.append("image", image, "card.jpg");
  const r = await fetch(`${INFERENCE_URL}/predict`, { method: "POST", body: form });
  if (!r.ok) throw new Error(`inference ${r.status}`);
  return r.json();
}
```

- [ ] **Step 7:** `app/layout.tsx`:

```tsx
export const metadata = { title: "TCG Card Recognizer" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}
```

- [ ] **Step 8:** `app/page.tsx`:

```tsx
export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", padding: "3rem", maxWidth: 720, margin: "0 auto" }}>
      <h1>TCG Card Recognizer</h1>
      <p>Upload a Pokémon card and get an instant attribute breakdown. (Foundation build — scan flow lands in Phase ②.)</p>
    </main>
  );
}
```

- [ ] **Step 9:** `.dockerignore`: `node_modules\n.next\nDockerfile\n.dockerignore`
- [ ] **Step 10:** `Dockerfile` (multi-stage, standalone):

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=10 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["node", "server.js"]
```

- [ ] **Step 11:** Run test: `cd apps/web && npm install && npm test` → Expected: PASS. Then `mkdir -p public`.
- [ ] **Step 12:** Commit: `git add apps/web && git commit -m "feat(web): Next.js skeleton with health route + inference client"`

---

## Task 4: Sentinel placeholder (inert) — TDD

**Files:** Create `services/sentinel/{Dockerfile,package.json,tsconfig.json,src/index.ts}`

- [ ] **Step 1:** `package.json`:

```json
{
  "name": "sentinel",
  "private": true,
  "type": "module",
  "scripts": { "build": "tsc", "start": "node dist/index.js", "test": "node --test" },
  "devDependencies": { "typescript": "5.7.2", "@types/node": "22.10.2" }
}
```

- [ ] **Step 2:** `tsconfig.json`:

```json
{ "compilerOptions": { "target": "ES2022", "module": "ES2022", "moduleResolution": "bundler",
  "outDir": "dist", "rootDir": "src", "strict": true, "esModuleInterop": true, "skipLibCheck": true },
  "include": ["src"] }
```

- [ ] **Step 3:** `src/index.ts` — inert heartbeat until creds arrive:

```ts
const paused = process.env.SENTINEL_PAUSED !== "false";
const hasCreds = Boolean(process.env.GITHUB_APP_ID && process.env.SLACK_BOT_TOKEN);

function status(): string {
  if (paused) return "PAUSED (set SENTINEL_PAUSED=false to enable)";
  if (!hasCreds) return "IDLE (waiting for GitHub App + Slack tokens)";
  return "ACTIVE";
}

console.log(`[sentinel] starting — ${status()}`);
setInterval(() => console.log(`[sentinel] heartbeat — ${status()}`), 60_000);
```

- [ ] **Step 4:** `Dockerfile`:

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build
FROM node:22-alpine AS runner
WORKDIR /app
COPY --from=build /app/dist ./dist
CMD ["node", "dist/index.js"]
```

- [ ] **Step 5:** Verify build: `docker build -t tcg-sentinel services/sentinel` → Expected: success.
- [ ] **Step 6:** Commit: `git add services/sentinel && git commit -m "feat(sentinel): inert placeholder service"`

---

## Task 5: Caddy ingress

**Files:** Create `Caddyfile`

- [ ] **Step 1:** `Caddyfile` — serve web on port 80 (HTTP only locally; LAN IP, no TLS):

```caddyfile
{
	auto_https off
}

:80 {
	reverse_proxy web:3000
}
```

(Note: `/api/*` is handled inside the Next.js app, so a single upstream is enough. `inference` and `db` are never exposed through Caddy.)

- [ ] **Step 2:** Commit: `git add Caddyfile && git commit -m "feat(proxy): Caddy LAN ingress to web"`

---

## Task 6: Docker Compose (base + dev + prod)

**Files:** Create `docker-compose.yml`, `docker-compose.override.yml`, `docker-compose.prod.yml`

- [ ] **Step 1:** `docker-compose.yml`:

```yaml
services:
  proxy:
    image: caddy:2-alpine
    ports:
      - "0.0.0.0:80:80"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
    depends_on:
      web:
        condition: service_healthy
    restart: unless-stopped

  web:
    build: ./apps/web
    env_file: .env
    environment:
      INFERENCE_URL: http://inference:8001
    depends_on:
      db:
        condition: service_healthy
      inference:
        condition: service_healthy
    restart: unless-stopped

  inference:
    build: ./services/inference
    env_file: .env
    volumes:
      - models:/models
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    env_file: .env
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 10
    restart: unless-stopped

  sentinel:
    build: ./services/sentinel
    env_file: .env
    depends_on:
      - db
    restart: unless-stopped

volumes:
  caddy_data:
  pgdata:
  models:
```

- [ ] **Step 2:** `docker-compose.override.yml` (dev hot-reload mounts; auto-applied by `docker compose`):

```yaml
services:
  web:
    build:
      context: ./apps/web
      target: build
    command: npm run dev
    volumes:
      - ./apps/web:/app
      - /app/node_modules
      - /app/.next
  inference:
    command: ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001", "--reload"]
    volumes:
      - ./services/inference/app:/app/app
```

- [ ] **Step 3:** `docker-compose.prod.yml` (built images, no source mounts; used via `-f docker-compose.yml -f docker-compose.prod.yml`):

```yaml
services:
  web:
    restart: always
  inference:
    restart: always
  proxy:
    restart: always
  db:
    restart: always
  sentinel:
    restart: always
```

- [ ] **Step 4:** Commit: `git add docker-compose*.yml && git commit -m "feat: docker compose base/dev/prod overlays"`

---

## Task 7: Smoke test script

**Files:** Create `scripts/smoke.sh`

- [ ] **Step 1:** `scripts/smoke.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
HOST="${PUBLIC_HOST:-localhost}"
cd "$(dirname "$0")/.."
[ -f .env ] || cp .env.example .env
echo "==> building + starting stack"
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
cleanup() { docker compose -f docker-compose.yml -f docker-compose.prod.yml down -v; }
trap cleanup EXIT

echo "==> waiting for web health via proxy"
for i in $(seq 1 60); do
  if curl -fsS "http://${HOST}/api/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
[ "${ok:-0}" = "1" ] || { echo "FAIL: web health never came up"; docker compose logs --tail=50; exit 1; }

echo "==> checking inference stub directly"
docker compose exec -T inference python -c "import urllib.request,json; print(urllib.request.urlopen('http://localhost:8001/health').read().decode())"

echo "SMOKE OK"
```

- [ ] **Step 2:** `chmod +x scripts/smoke.sh`
- [ ] **Step 3:** Run: `bash scripts/smoke.sh` → Expected: ends with `SMOKE OK`.
- [ ] **Step 4:** Commit: `git add scripts/smoke.sh && git commit -m "test: compose smoke test"`

---

## Task 8: GitHub Actions CI

**Files:** Create `.github/workflows/review.yml`, `.github/workflows/build-tests.yml`

- [ ] **Step 1:** `review.yml`:

```yaml
name: review
on:
  pull_request:
jobs:
  web-lint:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: apps/web } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: apps/web/package.json }
      - run: npm install
      - run: npm run typecheck
  inference-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install ruff
      - run: ruff check services/inference
```

- [ ] **Step 2:** `build-tests.yml`:

```yaml
name: build-tests
on:
  pull_request:
  push: { branches: [main] }
jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: apps/web/package.json }
      - run: cd apps/web && npm install && npm test
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: cd services/inference && pip install -r requirements.txt && python -m pytest -q
  smoke:
    runs-on: ubuntu-latest
    needs: unit
    steps:
      - uses: actions/checkout@v4
      - run: cp .env.example .env
      - run: bash scripts/smoke.sh
```

- [ ] **Step 3:** Commit: `git add .github && git commit -m "ci: review + build-tests workflows"`

---

## Task 9: Branch protection + push

- [ ] **Step 1:** Push branch and open as the first PR (validates CI before protecting):
  `git push -u origin HEAD` (from a feature branch `phase1-foundation`).
- [ ] **Step 2:** After CI is green and merged, enable branch protection on `main` via `gh api`:

```bash
gh api -X PUT repos/kobozo/tcg-recognizer/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f "required_status_checks[strict]=true" \
  -f "required_status_checks[checks][][context]=unit" \
  -f "required_status_checks[checks][][context]=smoke" \
  -F "enforce_admins=false" \
  -F "required_pull_request_reviews[required_approving_review_count]=1" \
  -F "restrictions=null"
```

- [ ] **Step 3:** Verify: `gh api repos/kobozo/tcg-recognizer/branches/main/protection -q .required_pull_request_reviews.required_approving_review_count` → Expected: `1`.

---

## Self-Review notes

- **Spec coverage:** monorepo layout ✔, compose services (proxy/web/inference/db/sentinel) ✔, Caddy LAN ingress ✔, env/secrets ✔, CI review + build-tests + smoke ✔, branch protection ✔, dev/prod overlays ✔. (trainer service deferred to Phase ③; auth/admin to Phase ②; full Sentinel to Phase ④ — all intentionally out of this phase.)
- **Placeholder scan:** all steps contain concrete code/commands.
- **Type consistency:** `/predict` response shape (per-field `{value, conf}` + `model_version`) is fixed here and reused by the web `lib/inference.ts` client and Phase ② result UI.
