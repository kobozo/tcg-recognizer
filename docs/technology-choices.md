# Technology Choices — What We Used and Why

This document is the central technical justification for the project. For every
major technology in the stack it answers four questions:

- **What it is** — a one-line definition.
- **Where we use it** — the concrete file or service, so the claim is verifiable.
- **Why we chose it** — the actual need it solves in *this* project.
- **Alternatives considered & trade-offs** — what else we weighed, and why we
  did not pick it.

The project is a **trading-card-game (TCG) card recognizer**: you photograph a
card, the system identifies it, and a web app lets users manage their
collection. Around that product sit the things a *real* ML system needs —
training, experiment tracking, data versioning, CI, and an AI assistant.

A guiding constraint shaped almost every choice: **everything must run on a
single CPU-only box** (the host has no GPU, no public IP, and no usable host
`pip`). So "could a student actually run this end-to-end on one machine?" was a
real selection criterion, not an afterthought.

Every technology listed below was confirmed to be *actually used* by reading the
dependency manifests **and** the code that imports them. Technologies that are
only declared but never exercised are not listed.

---

## 1. Frontend / Web

The user-facing app lives in `apps/web` and is a single Next.js application.

### Next.js 15 (App Router)

- **What it is** — a full-stack React framework with server-side rendering,
  file-based routing, and built-in API/route handlers.
- **Where we use it** — `apps/web` (version `15.1.3` in `apps/web/package.json`);
  the App Router lives under `apps/web/app/` (e.g. `app/scan/`, `app/assistant/`,
  `app/admin/`, `app/sets/`).
- **Why we chose it** — we needed one framework that serves the UI *and* hosts
  server-side logic (talking to the inference service, the database, and the LLM
  providers) without standing up a separate Node backend. The App Router lets us
  put privileged code (DB queries, Anthropic API calls, auth) in **Server
  Components / route handlers** that never ship to the browser, while still
  rendering interactive client components (the camera scanner). One deployable,
  one mental model.
- **Alternatives considered & trade-offs** — a SPA (Vite/CRA) **plus** a
  separate Express/Fastify API was the obvious alternative, but that doubles the
  number of services to run and deploy on our one box and pushes secret-handling
  to a hand-rolled backend. Remix/SvelteKit are comparable full-stack options;
  Next.js won on ecosystem maturity, first-class React 19 support, and the
  team's familiarity. The cost is Next.js's complexity and its fast-moving
  release cadence (App Router conventions change between majors).

### React 19

- **What it is** — the UI library Next.js renders.
- **Where we use it** — `react`/`react-dom` `19.0.0`; every component under
  `apps/web/app` and `apps/web/components`.
- **Why we chose it** — it is the native rendering model for Next 15 and gives us
  Server Components (so data-fetching and rendering happen on the server by
  default) plus a mature client model for the interactive scanner.
- **Alternatives considered & trade-offs** — Vue/Svelte are lighter, but the App
  Router is built around React; mixing would mean fighting the framework. The
  trade-off of React 19 being recent (some libraries lag) is acceptable because
  our dependency surface is small.

### TypeScript

- **What it is** — typed JavaScript.
- **Where we use it** — the entire `apps/web` codebase (`typescript 5.7.2`,
  `npm run typecheck` = `tsc --noEmit`, enforced in CI by
  `.github/workflows/review.yml`).
- **Why we chose it** — the web app crosses several contracts: the inference
  service's JSON response, the LLM provider interface (`lib/llm/types.ts`), the
  Prisma models, and the 512-dim embedding that *must* match the Python server
  byte-for-byte. Static types catch shape mismatches at compile time instead of
  at runtime in front of the teacher.
- **Alternatives considered & trade-offs** — plain JavaScript would be faster to
  write but offers no safety on those contracts; given the cross-service data
  flow, the up-front typing cost pays for itself. We enforce it in CI so it
  cannot silently rot.

### Tailwind CSS

- **What it is** — a utility-first CSS framework.
- **Where we use it** — `tailwindcss ^3.4` with `postcss`/`autoprefixer`; styling
  across all pages under `apps/web/app`.
- **Why we chose it** — for a small team we wanted consistent, responsive styling
  without inventing a design system or maintaining separate CSS files. Utility
  classes keep markup and style co-located, which is fast for an app with many
  simple pages (scan, sets, admin, assistant).
- **Alternatives considered & trade-offs** — CSS Modules or styled-components
  keep styles scoped but require naming and file-juggling; a component kit (MUI,
  Chakra) brings heavier bundles and opinionated theming. Tailwind's known cost
  is verbose class strings in JSX; for our page count that is a fair trade.

### Auth.js v5 (NextAuth) + bcryptjs

- **What it is** — the authentication framework for Next.js (`next-auth`
  `5.0.0-beta.25`, aka Auth.js v5); `bcryptjs` hashes passwords.
- **Where we use it** — `apps/web/lib/auth.ts`: a **Credentials** provider with a
  JWT session strategy, wired to Prisma via `@auth/prisma-adapter`, with
  `role` (USER/ADMIN) carried on the session/JWT. Passwords are verified with
  `bcrypt.compare`.
- **Why we chose it** — the app needs real per-user accounts (each user owns
  their scans/collection) and an **admin** role to gate the MLOps/admin pages
  (`app/admin`). Auth.js is the de-facto auth layer for Next.js, integrates
  natively with the App Router, and the Prisma adapter means sessions/users live
  in the same Postgres we already run.
- **Alternatives considered & trade-offs** — a hosted identity provider
  (Auth0/Clerk/Supabase Auth) is less code but adds an external dependency and an
  account requirement, which conflicts with the "runs on one offline LAN box"
  constraint. Rolling our own session handling is exactly the kind of
  security-sensitive code you should not hand-roll for a graded project. We chose
  email+password Credentials (not OAuth) deliberately: no third-party redirect is
  reachable on an offline LAN. The cost is being on a `beta` of v5, accepted
  because v5 is the version aligned with the App Router.

### Prisma

- **What it is** — a type-safe ORM and migration tool for Node.
- **Where we use it** — `apps/web/prisma/schema.prisma` (models `User`,
  `Session`, `Scan`, enum `Role`), the generated client used through
  `apps/web/lib/db.ts`, migrations via `prisma migrate deploy`, and seeding via
  `prisma db seed`.
- **Why we chose it** — Prisma generates a fully-typed client from the schema, so
  the TypeScript app and the database stay in lockstep, and `migrate` gives us
  reproducible schema evolution (important when the teacher runs it fresh).
  Crucially it also targets **PostgreSQL**, which we need for pgvector.
- **Alternatives considered & trade-offs** — Drizzle is lighter and closer to raw
  SQL; raw `pg` gives full control. We picked Prisma for its migration workflow
  and generated types, which remove a whole class of runtime errors. The
  trade-off: pgvector's `vector` type and the ANN operators are not first-class in
  Prisma, so the **vector search itself is done in the Python inference service
  with raw SQL** (see §2), and Prisma manages only the relational schema. That
  split is intentional, not a workaround.

### zod

- **What it is** — a TypeScript-first runtime schema/validation library.
- **Where we use it** — `apps/web/lib/validation.ts` (e.g. `credentialsSchema`,
  consumed by the Auth.js `authorize` callback in `lib/auth.ts`).
- **Why we chose it** — TypeScript types vanish at runtime, but login input and
  other external data arrive untyped. zod validates *and* infers the static type
  from one schema, so the boundary is checked exactly once and the rest of the
  code is safely typed.
- **Alternatives considered & trade-offs** — Yup/Joi do similar validation but
  with weaker TypeScript inference; manual `if` checks are error-prone and
  untyped. zod's type-inference is the deciding factor in a TS codebase.

### lucide-react

- **What it is** — an open-source SVG icon set as React components.
- **Where we use it** — across the UI: `app/page.tsx`, `app/scan/`,
  `app/assistant/`, `app/sets/`, `app/admin/`, etc.
- **Why we chose it** — tree-shakeable per-icon imports keep the bundle small,
  the icons are consistent, and it is the icon library that pairs idiomatically
  with a Tailwind/React app.
- **Alternatives considered & trade-offs** — react-icons bundles many icon packs
  (heavier, inconsistent styling); hand-made SVGs are tedious. Lucide is a clean
  single-style set, which is all we need.

---

## 2. Datastore & Vector Search

### PostgreSQL (via the `pgvector/pgvector:pg16` image)

- **What it is** — a relational SQL database (Postgres 16).
- **Where we use it** — the `db` service in `docker-compose.yml`
  (`image: pgvector/pgvector:pg16`). It backs Prisma (users, sessions, scans)
  **and** holds the recognition vector index (`card_vectors`).
- **Why we chose it** — we already need a relational DB for the app's data, and
  Postgres is the most robust open-source choice with first-class extension
  support — which is precisely what lets us add vector search *in the same
  database* (next entry). One datastore for both the app and the ML index.
- **Alternatives considered & trade-offs** — MySQL/MariaDB lack a mature,
  drop-in ANN extension; SQLite cannot serve a multi-service app concurrently.
  Postgres is the natural fit and removes the need for a second datastore.

### pgvector (Postgres extension) — and *why an extension, not a dedicated vector DB*

- **What it is** — a Postgres extension adding a `vector` column type and
  nearest-neighbour search operators (`<=>` cosine distance, with ANN indexing).
  It backs **both** vector channels in the system: the core visual recognizer and
  the optional OCR text channel.
- **Where we use it** — two tables, both queried with the same cosine operator:
  the visual index `card_vectors` in `services/inference/app/main.py`
  (`ORDER BY embedding <=> %s::vector LIMIT %s`, similarity `1 - (embedding <=>
  %s::vector)`, `vector(512)` per card, built by the trainer); **and** the OCR
  text channel's `card_text_vectors` in `services/ocr/app/main.py`
  (`vector(256)` per card, same `<=>` query, filtered by `game`). The Compose
  comment on the `db` service notes pgvector = "Postgres 16 + the `vector`
  extension (ANN index for recognition)."
- **Why we chose it** — this is the heart of recognition: a card photo becomes a
  512-dim embedding, and we need the nearest reference card. pgvector lets us do
  that **inside the database we already run**, in one SQL statement, with the
  card's relational metadata (name, set, number, rarity, image URL) joined on the
  same row — no second system to deploy, sync, or keep consistent. For a
  single-box deployment this is decisive: zero extra infrastructure. The same
  reasoning extends to the OCR text channel: rather than stand up a second store
  for its 256-dim text vectors, we reuse pgvector (`card_text_vectors`), so the
  whole system has **one vector technology and one datastore**.
- **Alternatives considered & trade-offs** — a **dedicated vector DB** (Qdrant,
  Milvus, FAISS, Pinecone) offers more advanced indexing and scales further. But
  it means (a) another service to run on the one box, and (b) keeping the vectors
  *and* the card metadata in sync across two stores. At our scale (thousands of
  cards) pgvector's recall and latency are more than sufficient, and co-locating
  vectors with metadata is a real simplification. The trade-off is that we give
  up the fancier indexing/sharding of a specialised engine — which we do not
  need.

### Qdrant — *evaluated for the OCR text channel, then consolidated away*

- **What it is** — a dedicated, standalone vector search database.
- **Status: not used.** An earlier iteration ran the OCR text channel on a
  separate Qdrant service. We evaluated keeping a dedicated vector DB for that
  channel and **deliberately decided against it**: pgvector and Qdrant were two
  technologies doing the *same job* (vector similarity search), and the core
  already runs Postgres + pgvector. So we **consolidated the OCR text vectors
  onto pgvector** (the `card_text_vectors` table in `services/ocr/app/main.py`,
  queried with the same cosine `<=>` operator as `card_vectors`), and removed
  Qdrant from the project entirely — one fewer service, one fewer client
  dependency (`qdrant-client`), and one fewer named volume.
- **Why consolidate** — at this project's scale a second vector engine bought us
  nothing the core's pgvector didn't already provide, while costing an extra
  container, an extra dependency, and a second store to keep consistent. Reusing
  the database we already operate is the simpler, leaner choice and keeps the
  whole stack on a single vector technology. The OCR channel remains fully
  **opt-in** (Compose profile `extras`) and defensive (empty results, never 500)
  — consolidating its storage onto pgvector did not change that isolation.

---

## 3. Backend / Inference Service

The recognition brain is a small Python service in `services/inference`.

### Python 3.12

- **What it is** — the language for all ML/CV/serving code.
- **Where we use it** — `services/inference`, `services/trainer`, `services/ocr`
  (all `python:3.12-slim` images).
- **Why we chose it** — the entire CV/ML ecosystem we need (OpenCV, NumPy,
  Pillow, onnxruntime, PyTorch, MLflow, DVC) is Python-native. Doing the vision
  work anywhere else would mean fighting bindings.
- **Alternatives considered & trade-offs** — none realistic for CV/ML; the only
  question was *which* services are Python vs Node, and we kept Python to the
  inference/training/OCR side and Node to the web side, talking over HTTP.

### FastAPI + Uvicorn

- **What they are** — FastAPI is an async Python web framework with automatic
  validation from type hints; Uvicorn is the ASGI server that runs it.
- **Where we use them** — `services/inference/app/main.py` and
  `services/ocr/app/main.py` define `FastAPI()` apps with `@app.post("/predict")`
  / `/ocr_search` etc.; the Dockerfiles launch them with
  `uvicorn app.main:app --host 0.0.0.0 --port 8001/8002`. Versions pinned in
  `requirements.txt` (`fastapi==0.115.6`, `uvicorn[standard]==0.34.0`).
- **Why we chose them** — the inference service needs to accept multipart image
  uploads (`UploadFile`, via `python-multipart`) and return JSON, fast, with
  minimal boilerplate. FastAPI derives request parsing and validation from the
  endpoint signature, and Uvicorn gives production-grade ASGI serving. Together
  they are the standard, lightweight way to expose a Python model over HTTP.
- **Alternatives considered & trade-offs** — Flask is simpler but synchronous and
  needs more manual validation/serialization; Django is far too heavy for a
  two-endpoint service. FastAPI's only real cost (its async model) is irrelevant
  here and a non-issue for our load.

### psycopg2 (binary)

- **What it is** — the PostgreSQL driver for Python.
- **Where we use it** — `services/inference/app/main.py` (`_query_index` opens a
  connection and runs the pgvector NN query). `psycopg2-binary` in
  `services/inference/requirements.txt`.
- **Why we chose it** — the vector query needs raw SQL with the pgvector `<=>`
  operator and a `::vector` cast, which an ORM does not express cleanly. psycopg2
  is the mature, ubiquitous Postgres driver and lets us write that one precise
  query directly. The `-binary` wheel avoids compiling against libpq on the box
  (no build toolchain needed).
- **Alternatives considered & trade-offs** — `asyncpg` is faster and async, but
  our query is a single short call per request; the simplicity of psycopg2 wins.
  An ORM on the Python side is unnecessary — Prisma already owns the schema; the
  inference service is a pure read client.

---

## 4. Machine Learning & Computer Vision

This is the technical core. The recognition pipeline is:
**photo → deskew → embed → pgvector nearest-neighbour → (optional) geometric
re-rank**. There are two selectable embedding backends and an optional learned
projection head.

### OpenCV (`opencv-python-headless`)

- **What it is** — the standard computer-vision library.
- **Where we use it** — `services/inference/app/embedding.py` for **deskew**
  (grayscale → Gaussian blur → Canny edges → contour detection → pick the largest
  convex quad → perspective-warp the card to a flat rectangle) and color-space
  conversions; and `services/inference/app/rerank.py` for **ORB features +
  RANSAC homography** (geometric verification).
- **Why we chose it** — a card photographed in the wild is rotated, skewed, and
  partially in perspective. Before any embedding, we must find and flatten the
  card. OpenCV provides exactly these classical-CV primitives (Canny,
  `findContours`, `getPerspectiveTransform`, `warpPerspective`, `ORB`,
  `findHomography`) on **CPU**, deterministically, with no model to train. We use
  the `headless` build because the service has no display.
- **Alternatives considered & trade-offs** — a learned detector/segmenter (e.g.
  a corner-detection NN) would handle harder cases but needs labelled data, a GPU
  to train, and a model to ship — overkill for a flat, rigid, rectangular object
  where classical geometry works well on CPU.

### NumPy

- **What it is** — the numerical array library underpinning all the math.
- **Where we use it** — everywhere in `embedding.py` (the classical descriptor,
  the L2-normalisation, the `_fit_512` projection, **and the projection head
  applied as a pure-numpy 2-layer MLP**) and `rerank.py`.
- **Why we chose it** — it is the lingua franca between OpenCV, Pillow,
  onnxruntime, and our own descriptor code; and notably it lets us **apply the
  trained projection head at inference without PyTorch** (see DINOv2/PyTorch
  below). One dependency, used by everything.
- **Alternatives considered & trade-offs** — none; NumPy is foundational.

### Pillow (PIL)

- **What it is** — the Python imaging library for decoding/resizing images.
- **Where we use it** — decoding uploaded bytes (`Image.open(...)`) in both
  services, and the DINOv2 preprocessing (bicubic resize + centre-crop) in
  `embedding.py`.
- **Why we chose it** — it is the simplest, most portable way to decode arbitrary
  uploaded image formats and do the exact resize/crop the DINOv2 image processor
  expects. We deliberately mirror Pillow's bicubic resize to match transformers.js
  on the browser side.
- **Alternatives considered & trade-offs** — OpenCV can also decode/resize, but
  Pillow's resampling matches the Hugging Face image-processor reference more
  directly, which matters for server/browser parity.

### The classical descriptor (default embedder)

- **What it is** — a *hand-crafted, deterministic* 512-dim visual descriptor: a
  4×4 spatial grid of mean-RGB + grayscale-std, a mean-subtracted 18×18 grayscale
  block, per-channel color histograms, and a HOG-like gradient-orientation
  histogram — concatenated, padded to 512, L2-normalised.
- **Where we use it** — `_embed_classical` in
  `services/inference/app/embedding.py` (the default when `EMBEDDER` is unset),
  with a **byte-identical** TypeScript port in `apps/web/lib/clientEmbedding.ts`.
- **Why we chose it** — it is the **zero-dependency, zero-download, fully
  deterministic baseline**: it runs on CPU with only NumPy/OpenCV/Pillow, needs
  no model fetch or network, and — because every resize uses explicit
  nearest-neighbour index math — it reproduces **bit-for-bit in the browser**.
  That means the default stack and CI work completely offline, and on-device
  embeddings match the server index exactly. It is deliberately *spatial* (not
  just global histograms) because TCG cards share a near-identical frame, so
  *where* color/structure sits is what distinguishes them.
- **Alternatives considered & trade-offs** — a learned embedding (next entry) is
  more accurate but requires a model download and is not trivially reproducible
  in JS. We keep the classical descriptor as the always-available default and
  make the learned path opt-in, so the system degrades gracefully with no
  network.

### DINOv2-small + ONNX + onnxruntime (the *learned* embedder)

- **What they are** — DINOv2-small is a self-supervised Vision Transformer that
  produces strong general-purpose image embeddings; ONNX is a portable model
  format; onnxruntime is a cross-platform inference engine.
- **Where we use them** — `EMBEDDER=onnx` path in
  `services/inference/app/embedding.py`: it lazily downloads `Xenova/dinov2-small`
  (`onnx/model.onnx` + `preprocessor_config.json`) to the mounted `/models`
  cache, runs it via `onnxruntime.InferenceSession` on `CPUExecutionProvider`,
  takes the CLS token of `last_hidden_state`, and L2-normalises to 512 dims. The
  **same model** runs in the browser through transformers.js
  (`apps/web/lib/onnxEmbedding.ts`). `onnxruntime` is in both the inference and
  trainer `requirements.txt`.
- **Why we chose DINOv2-small** — we wanted a learned embedding that
  out-discriminates the hand-crafted one *without training a backbone ourselves*.
  DINOv2 is self-supervised, so its features generalise to card art without any
  labels, and the **small** variant is the sweet spot for CPU latency. We take
  the CLS token because it is a single global descriptor that maps cleanly to our
  fixed `vector(512)` schema.
- **Why ONNX + onnxruntime at inference, *not* PyTorch** — at serving time we
  only need a forward pass. onnxruntime runs the exported graph with a far
  smaller footprint than a full PyTorch install (no multi-hundred-MB framework in
  the inference image), starts fast, and runs efficiently on CPU. Equally
  important, ONNX is the format transformers.js consumes, so **the exact same
  model file runs in the browser**, giving us server/browser embedding parity for
  free. Shipping PyTorch into the always-on inference service would bloat the
  image for no benefit.
- **Alternatives considered & trade-offs** — CLIP would also give strong
  embeddings but is larger and its text tower is wasted here; a custom-trained
  CNN needs labels and a GPU. The learned path's cost is a one-time model
  download, so it is **opt-in** and falls back to the classical descriptor if the
  model can't be fetched — the service never breaks.

### PyTorch (CPU-only, *trainer-only*) + the projection head

- **What it is** — the deep-learning framework, installed as the **CPU wheel**.
- **Where we use it** — *only* in `services/trainer` (Dockerfile installs
  `torch==2.5.1` from the CPU index), and *only* to **train a tiny projection
  head**: `services/trainer/src/train_head.py` precomputes frozen DINOv2 features,
  then trains a 2-layer MLP with an InfoNCE/metric-learning objective so a card's
  augmented views pull toward its reference. The output `head.npz` is then
  **applied in pure NumPy at inference** (`_apply_head` in `embedding.py`).
- **Why we chose it (and why CPU-only / trainer-only)** — training the head needs
  autograd and an optimiser, which is exactly what PyTorch provides. But we
  deliberately confine it to the trainer: the head is small, training is
  occasional, and once trained it is just two weight matrices we can multiply in
  NumPy. So the **inference service needs no torch at all** — keeping it lean and
  fast. The CPU wheel (no CUDA) keeps even the trainer image small and runnable
  on our GPU-less box.
- **Alternatives considered & trade-offs** — we could fine-tune DINOv2 itself,
  but that is heavy and needs a GPU; a small head on frozen features captures most
  of the benefit cheaply. We could also have used scikit-learn for a linear
  head, but the InfoNCE objective is naturally expressed with autograd. The
  trade-off — torch only in the trainer — is exactly what we wanted.

### ORB + RANSAC homography (geometric re-ranking)

- **What it is** — ORB is a fast binary keypoint detector/descriptor; RANSAC
  homography fits a robust planar transform between two images.
- **Where we use it** — `services/inference/app/rerank.py` (`orb_inliers`,
  `rerank`), invoked by `main.py` when `RERANK_TOP_K > 0` and reference card
  images are mounted.
- **Why we chose it** — embedding nearest-neighbour returns a *shortlist*, but
  two cards with the same frame and different art can be near-ties. Because cards
  are flat, rigid, planar objects, a **homography fit is an exact-match test**:
  the true card yields many RANSAC-consistent ORB correspondences, a look-alike
  yields few. Re-ranking the shortlist by inlier count lifts recall@1 toward the
  embedding's recall@K — and it needs **no GPU, no model, no network**, just
  OpenCV.
- **Alternatives considered & trade-offs** — SIFT is more robust but patent-laden
  and slower; a learned matcher (SuperGlue) needs a GPU/model. ORB is the
  CPU-friendly, license-clean choice, and for rigid planar cards it is plenty
  accurate. It is opt-in so the default path stays minimal.

### Tesseract OCR (`pytesseract`)

- **What it is** — Google's open-source OCR engine, called from Python via
  `pytesseract` (which shells out to the `tesseract-ocr` binary).
- **Where we use it** — `services/ocr/app/main.py` (`/ocr_search` runs
  `pytesseract.image_to_string`); the `tesseract-ocr` binary is installed in
  `services/ocr/Dockerfile`.
- **Why we chose it** — the OCR channel needs to read a card's printed name and
  number to look it up by *text*. Tesseract is the standard, fully-offline,
  CPU-only OCR engine — no API key, no network, ships in the image. That fits the
  "self-contained, runs on one box" rule.
- **Alternatives considered & trade-offs** — cloud OCR (Google Vision, AWS
  Textract) is more accurate but requires an account, network, and per-call cost;
  EasyOCR/PaddleOCR are heavier and prefer a GPU. For an optional, offline extra
  channel, Tesseract is the right weight.

> Note: the OCR channel's **text embedding is intentionally model-free** — a
> deterministic FNV-hashed char-3-gram + token vector (`text_embed` in
> `services/ocr/app/main.py`), not a neural text model. It is robust to fuzzy
> OCR output and needs zero downloads, consistent with the channel's
> self-contained design.

### transformers.js (`@huggingface/transformers`) — browser parity

- **What it is** — Hugging Face's JavaScript runtime for running ONNX models in
  the browser/Node.
- **Where we use it** — `apps/web/lib/onnxEmbedding.ts` dynamically imports
  `@huggingface/transformers` and runs **the same `Xenova/dinov2-small` model**
  (WebGPU with a wasm/CPU fallback), taking the CLS token and fitting to 512 dims
  — mirroring the Python server exactly.
- **Why we chose it** — when the learned embedder is enabled, we want the option
  to embed the card **on-device** (privacy, offloading the server) and have that
  embedding match the server's pgvector index. transformers.js runs the identical
  ONNX model with the identical preprocessing, so on-device and server embeddings
  are interchangeable. It is dynamically imported so it never bloats the default
  bundle.
- **Alternatives considered & trade-offs** — hand-porting a transformer to JS is
  infeasible; calling the server for every embed defeats the on-device goal.
  transformers.js is the only practical way to get *the same model* in the
  browser. The trade-off (a large lazily-loaded dependency) is contained behind
  the opt-in onnx path.

---

## 5. Data & MLOps

These make the project a *real* ML system, not a one-off script — and map to the
course's MLOps requirements.

### MLflow

- **What it is** — an experiment-tracking server + model registry.
- **Where we use it** — the `mlflow` service in `docker-compose.yml`
  (`ghcr.io/mlflow/mlflow:v2.22.0`, SQLite backend + local artifact store); the
  trainer logs to it via `mlflow-skinny` — `services/trainer/src/main.py`
  (`set_experiment(f"tcg-{game}")`, `start_run`, params/metrics) and
  `train_head.py` (logs head hyper-params, final loss, the `head.npz` artifact).
- **Why we chose it** — every training/eval run must be **recorded and
  comparable**: which embedder, sample size, eval settings, and the resulting
  recall metrics. MLflow is the de-facto open-source experiment tracker, runs
  self-hosted on our box, and its UI (port 5000) lets the teacher *see* the run
  history and the registered model. We use **`mlflow-skinny`** in the trainer to
  keep that image lean (just the tracking client, no server deps).
- **Alternatives considered & trade-offs** — Weights & Biases is excellent but
  SaaS (account + network, against the offline rule); TensorBoard tracks scalars
  but is not a run/registry system. MLflow self-hosts cleanly and covers tracking
  *and* registry. Its tracking calls are wrapped best-effort so a missing MLflow
  never breaks a training run.

### DVC (Data Version Control)

- **What it is** — Git-for-data: it versions datasets and defines reproducible
  pipelines, storing large files in a separate remote.
- **Where we use it** — `dvc.yaml` defines `download` and `train` stages
  parametrised from `params.yaml`, with `ml/metrics.json` declared as a DVC
  metric; the card dataset is tracked via `ml/datasets/pokemon.dvc` and pushed to
  a **local-filesystem remote** (`.dvc-remote/`). DVC is run through
  `scripts/dvc.sh`. `dvc==3.*` is in `services/trainer/requirements.txt` (core
  only, no cloud extras, to keep the image lean).
- **Why we chose it** — for reproducibility we must version the *data* and the
  *pipeline*, not just the code. DVC pins the dataset by content hash and makes
  `dvc repro` re-run a **real** training (its stages shell out to the dockerised
  trainer, so no logic is duplicated). It integrates with Git, so a tag captures
  code + data + params together.
- **Alternatives considered & trade-offs** — committing the dataset to Git bloats
  the repo; ad-hoc scripts give no provenance. DVC is the standard tool and maps
  directly onto the course's data-versioning requirement. We use a **local**
  remote (no S3/GCS) to stay offline and dependency-light.

### `params.yaml` / the YAML pipeline definition

- **What it is** — the DVC pipeline (`dvc.yaml`) plus its parameter file.
- **Where we use it** — `dvc.yaml`'s `train` stage reads `train.game`,
  `train.sample_size`, `train.embedder`, `train.embed_dim`, eval settings, and
  `train.rerank_top_k`; the trainer is configured from `config.yaml`.
- **Why we chose it** — declaring inputs, params, outputs, and metrics in YAML is
  what makes a run **reproducible and diffable**: change a param, `dvc repro`
  knows what to re-run, and the metric delta is visible. This is MLOps maturity
  level 1 (a defined, reproducible pipeline) done with the standard tool.
- **Alternatives considered & trade-offs** — a Makefile or bash script can also
  orchestrate, but without DVC's dependency graph, content-hash caching, or
  metric tracking. The YAML approach is the idiomatic DVC pattern.

### GitHub Actions (CI)

- **What it is** — GitHub's CI/CD service.
- **Where we use it** — `.github/workflows/build-tests.yml` (jobs: `unit` —
  `npm test` + Python `pytest`; `smoke` — `scripts/smoke.sh` boots the stack;
  `dupe-guard`) and `.github/workflows/review.yml` (web `tsc` typecheck + `ruff`
  lint of the inference service).
- **Why we chose it** — every PR must be automatically validated: web tests,
  Python tests, a full smoke boot, type-checks, and lint. GitHub Actions is
  native to the repo host, free for this scale, and needs no extra
  infrastructure. The **smoke** job is notable: it actually `docker compose`-boots
  the stack, proving the system runs, not just that units pass.
- **Alternatives considered & trade-offs** — GitLab CI / Jenkins are comparable
  but would require moving or self-hosting. Actions is zero-setup given GitHub
  hosting.

### CodeRabbit (AI code review)

- **What it is** — an AI-powered automated PR reviewer (GitHub app).
- **Where we use it** — on pull requests; documented in `AI_DISCLOSURE.md`
  ("pull requests were additionally reviewed by an automated reviewer
  (CodeRabbit); findings were addressed in follow-up commits").
- **Why we chose it** — since the project is openly AI-built, an **independent
  automated reviewer** on every PR adds a second pair of eyes that catches bugs,
  style issues, and risky changes the author/agent might miss — raising review
  rigour without a second human always available. It works as a GitHub app with
  no repo config required.
- **Alternatives considered & trade-offs** — relying solely on the author's own
  review, or on human-only review, gives less consistent coverage. CodeRabbit is
  a SaaS dependency, but it operates on PRs only and does not affect the runtime
  stack.

### uv / uvx (host-side DVC runner)

- **What it is** — `uv` is a fast Rust-based Python package manager; `uvx` runs a
  tool in an ephemeral, uv-managed environment.
- **Where we use it** — `scripts/dvc.sh` resolves the `dvc` CLI as: native `dvc`
  → else `uvx --from "dvc==3.*" dvc` → else a one-off trainer container.
- **Why we chose it** — **this host has `uv` but no usable `pip`** (a documented
  machine constraint), so `uvx` is how we run host-side DVC without a global
  install: it fetches and caches DVC in an isolated env on demand. Running DVC on
  the host (rather than docker-in-docker) is simplest because the `train` stage
  itself shells out to `docker compose`.
- **Alternatives considered & trade-offs** — `pip install dvc` isn't available
  here; running DVC only inside the trainer container would force
  docker-in-docker for the train stage. `uvx` neatly bridges the gap, with the
  container path kept as a final fallback for hosts that have neither.

---

## 6. LLM / AI (the Collection Assistant & VLM channel)

The app includes an AI assistant (and an optional vision-LLM recognition
channel) behind a **provider router** that can use a cloud model or a local one.

### Anthropic Claude (`claude-opus-4-8`) via `@anthropic-ai/sdk`

- **What it is** — Anthropic's Claude family of LLMs, accessed through the
  official TypeScript SDK.
- **Where we use it** — `apps/web/lib/llm/claude.ts` (`ClaudeProvider`, default
  model `claude-opus-4-8`, configurable via `ASSISTANT_MODEL`, auth via
  `ANTHROPIC_API_KEY`) and `apps/web/lib/llm/claude-vision.ts` for the optional
  VLM recognition channel.
- **Why we chose it** — the collection assistant needs a *capable* model for
  natural-language Q&A about a user's cards, and the optional VLM channel needs
  strong image-reading. Claude Opus is a top-tier model for both, and the
  official SDK handles the API cleanly (system prompt passed separately, content
  blocks, timeouts). The provider abstraction means Claude is the high-quality
  default *when an API key is present*. (Note: the code already accounts for
  Opus 4.x dropping the `temperature` parameter — `supportsTemperature` omits it
  for `claude-opus-4*`/`claude-fable*` to avoid HTTP 400s — i.e. it tracks the
  current API contract.)
- **Alternatives considered & trade-offs** — OpenAI/Gemini are alternatives, but
  the project standardised on Claude (the same model family that built it, per
  `AI_DISCLOSURE.md`), and Anthropic's SDK is first-class in TypeScript. The
  trade-off — cloud, paid, needs a key and network — is exactly why we pair it
  with a local fallback (next).

### Ollama (local `llama3.2` / `llava`)

- **What it is** — a runtime for serving open LLMs locally; we use
  **llama3.2** for chat and **llava** for vision.
- **Where we use it** — the opt-in `ollama` service (Compose profile `llm`,
  `OLLAMA_URL`); `apps/web/lib/llm/ollama.ts` (chat) and
  `apps/web/lib/llm/ollama-vision.ts` (vision, default `llava:7b`, override via
  `OLLAMA_VISION_MODEL`).
- **Why we chose it** — to offer a **private, free, offline** alternative to
  Claude: the assistant (and VLM channel) can run entirely on the local box with
  no API key and no data leaving the machine. This directly serves the "runs on
  one box, possibly offline" goal and demonstrates a self-hosted model path.
  It is gated behind the `llm` profile so it's harmless when absent.
- **Alternatives considered & trade-offs** — running raw `llama.cpp` or a Python
  server is more setup; Ollama gives a clean HTTP API and one-line model pulls.
  Local models on CPU are slower and less capable than Claude — hence Claude is
  preferred when configured, with Ollama as the private fallback.

### The provider router

- **What it is** — a small abstraction selecting and chaining LLM backends.
- **Where we use it** — `apps/web/lib/llm/router.ts` (`selectProviders`,
  `chatWith`, `chatRouted`) and the vision counterpart
  `apps/web/lib/llm/vision-router.ts`, behind the `LlmProvider` interface in
  `lib/llm/types.ts`.
- **Why we chose it** — we wanted the *choice* of cloud vs local to be a config
  decision (`LLM_PROVIDER=claude|ollama|auto`), not a code change, **with
  graceful fallback**: in `auto` it prefers Claude when configured and falls back
  to Ollama (or vice-versa), and if nothing is configured it raises
  `NoProviderError`, which the assistant turns into a benign "not configured"
  message. This is what makes the AI features robust on any deployment — full
  Claude, fully-local Ollama, or none at all — without breaking the app.
- **Alternatives considered & trade-offs** — hard-coding a single provider would
  be simpler but brittle (breaks with no key, or forces cloud). A heavier
  framework (LangChain) is unnecessary for two providers behind one interface;
  the tiny router is easier to read, test, and reason about.

---

## 7. Infrastructure / DevOps

### Docker

- **What it is** — OS-level containerisation.
- **Where we use it** — every service has a Dockerfile (`apps/web`,
  `services/inference`, `services/trainer`, `services/ocr`, `services/sentinel`)
  on slim base images (`python:3.12-slim`, etc.).
- **Why we chose it** — the stack mixes Node, Python, native CV libs, Postgres,
  and model runtimes. Containers pin each service's exact dependencies (e.g. the
  inference image installs `libglib2.0-0`/`libgomp1` for OpenCV/onnxruntime) so it
  runs identically on the dev box and in CI. "Works on my machine" becomes "works
  in the image."
- **Alternatives considered & trade-offs** — bare-metal installs would collide
  (two Python services, native libs, no host `pip`); containers isolate them
  cleanly.

### Docker Compose (with profiles)

- **What it is** — multi-container orchestration from one `docker-compose.yml`.
- **Where we use it** — `docker-compose.yml` wires `proxy`, `web`, `inference`,
  `db`, `sentinel`, `mlflow`, and (profile-gated) `trainer` (`tools`),
  `ocr` (`extras`), and `ollama` (`llm`), with health-checked
  `depends_on` and named volumes.
- **Why we chose it** — the whole system must come up with **one command** on the
  one box, with correct start-order (web waits for db+inference; proxy waits for
  web). **Profiles** are the key design choice: the *default* `docker compose up`
  brings only the core (so CI/smoke stay fast and deterministic), while the
  optional, heavier channels (the OCR text channel, local LLM, the one-shot trainer) are
  **opt-in** and never burden the default path. That keeps the demo simple and
  the optional experiments quarantined.
- **Alternatives considered & trade-offs** — Kubernetes is vastly overk/ill-fit
  for a single box; plain `docker run` scripts lose the dependency graph and
  profiles. Compose hits the exact sweet spot for one-host multi-service.

### Caddy (reverse proxy + automatic TLS) — *why over nginx*

- **What it is** — a modern web server / reverse proxy with **automatic HTTPS**.
- **Where we use it** — the `proxy` service (`caddy:2-alpine`) with a tiny
  `Caddyfile`: it reverse-proxies `web:3000`, serves plain HTTP on `:80` (for CI
  smoke), and serves HTTPS via Caddy's **internal CA** (`tls internal`,
  `local_certs`) on the LAN IP.
- **Why we chose it (over nginx)** — the scanner uses the camera
  (`getUserMedia`), which **browsers only allow in a secure context (HTTPS)**.
  But this is a LAN box with no public domain, so public ACME/Let's Encrypt
  cannot issue a cert. Caddy solves this in a few lines: it spins up its **own
  internal CA and issues a locally-trusted cert automatically** — no certbot, no
  manual OpenSSL, no cron renewal. nginx, by contrast, needs externally-provided
  certs and a separate tool to generate/renew them; achieving the same self-signed
  LAN HTTPS would be far more config. The `Caddyfile` is dramatically simpler than
  an equivalent nginx config, and it still serves plain HTTP so CI smoke works.
- **Alternatives considered & trade-offs** — **nginx** is the classic choice but
  has no built-in cert management; **Traefik** also does auto-TLS but is more
  complex to configure for this simple case. Caddy's only real trade-off is a
  browser trust prompt for the internal CA on first visit — a one-time,
  acceptable cost on a LAN.

### The "local-as-prod" model

- **What it is** — the deliberate decision that the **development setup *is* the
  production setup**: one `docker compose up` on one CPU box, bound to the LAN IP,
  is the whole deployment.
- **Where we see it** — services bind `0.0.0.0`/the LAN IP; HTTPS via Caddy's
  internal CA; all data stores (Postgres, MLflow's SQLite, Ollama models)
  are local volumes; LLM and learned-CV features all have offline/no-key
  fallbacks; CI even boots the *same* Compose stack in its smoke job.
- **Why we chose it** — there is no cloud target; the deliverable must run, in
  full, on a single offline-capable machine for the teacher. Designing every
  component to degrade gracefully (stub predictions if the DB is empty, classical
  embedder if no model, "not configured" if no LLM) means the *exact* artifact
  developed and CI-tested is what gets demoed — no separate prod environment to
  drift.
- **Alternatives considered & trade-offs** — a cloud deployment (managed
  Postgres, hosted vector DB, GPU inference) would scale better but is
  unavailable, costly, and untestable offline. The trade-off — no horizontal
  scaling — is irrelevant at this project's scale and is exactly the right call
  for the constraints.

---

## Why This Combination

These choices are not independent; they reinforce one shared goal — **a genuine
ML product, built with MLOps rigour and modern AI, that runs end-to-end on one
CPU-only box.**

- **One box, no GPU, possibly offline** drives the whole bottom layer: CPU-only
  PyTorch confined to the trainer, ONNX/onnxruntime instead of a heavyweight
  framework at inference, a deterministic *classical* embedder as the
  zero-download default, Tesseract for offline OCR, a local-filesystem DVC
  remote, self-hosted MLflow, Ollama as a local LLM, and Caddy issuing its own
  LAN TLS. Docker Compose *profiles* keep the heavy/optional parts opt-in so the
  core stays fast.
- **A real product, not a notebook** drives the web layer: Next.js + React +
  TypeScript + Prisma + Auth.js give actual accounts, roles, persistence, and a
  scanner UI — and TypeScript/zod keep the cross-service contracts honest.
- **The recognition core is engineered, not hand-wavy:** pgvector does ANN search
  *inside the app's own database* (co-located with metadata), with the option of
  a learned DINOv2 embedding (matched server-and-browser via ONNX/transformers.js)
  and an ORB+RANSAC geometric re-rank that exploits the fact that cards are flat
  rigid objects. Tesseract + a model-free text embedder form a *separate, opt-in*
  OCR channel that reuses the same pgvector store (`card_text_vectors`) — one
  vector technology for the whole system, not two.
- **MLOps rigour** is real, not decorative: MLflow tracks every run, DVC versions
  data and defines a reproducible YAML pipeline that triggers an actual training,
  and GitHub Actions (plus CodeRabbit) gate every change — including a smoke job
  that boots the *same* stack the teacher will run.
- **Modern AI** is integrated responsibly: a provider router lets the assistant
  use top-tier Claude when a key is present and fall back to a private local model
  (or degrade to an inert message) otherwise — capable when possible, robust
  always.

The result is a stack where each technology was picked for a concrete need under
real constraints, and where the pieces compose into a system that is, at once,
a usable product, a reproducible ML pipeline, and a single-command deployment.
