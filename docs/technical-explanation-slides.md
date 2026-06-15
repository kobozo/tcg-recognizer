# Technical Explanation Video — Slide Storyboard

A complete, slide-by-slide description of the deck for the **Technical Explanation Video**
(one of the three AI-project submission deliverables). For each slide it specifies the
**layout/visuals**, the exact **on-screen text**, any **table**, the **narration** (what you
say), and a **recording cue** (what to screen-capture / show as b-roll).

- **Length:** ~10–11 minutes · 10 slides.
- **Visual style:** clean white slides; a thin **emerald** (`#10B981`) accent bar across the top;
  dark slate (`#0F172A`) titles; a small uppercase **kicker** label (e.g. "3 · CORE") top-left;
  footer "TCG Card Recognizer · Technical Explanation". The **title slide** is inverted: dark
  slate background, white text, emerald rule. (Emerald = the app's primary colour, for brand
  consistency.)
- **How to use:** put the *On-screen text* on the slide; read the *Narration* aloud (or use it as
  speaker notes / teleprompter); capture the *Recording cue* as the visual.

> Source of truth: every number and claim below is backed by the repo — see
> [`recognition-pipeline.md`](recognition-pipeline.md), [`data-and-evaluation.md`](data-and-evaluation.md),
> [`mlops.md`](mlops.md), [`architecture.md`](architecture.md), and [`MODEL_CARD.md`](MODEL_CARD.md).

---

## Slide 1 — Title

**Layout / visuals:** Dark slate background on the top ~⅓ with the title in white and an emerald
horizontal rule beneath it; white lower section with the three subtitle lines in slate. No bullets.

**On-screen text:**
- **Title:** TCG Card Recognizer
- **Subtitle:** Technical Explanation — recognizing 1 of 20,000 Pokémon cards from a photo
- Erasmus — Artificial Intelligence / MLOps project
- Computer-vision card recognition · pgvector retrieval · DINOv2 + learned head · MLOps pipeline
- Built with an AI coding agent under the author's direction (see `AI_DISCLOSURE.md`)

**Narration:**
> "There are over twenty thousand Pokémon cards, and many of them look almost identical — same
> frame, same layout, often the same Pokémon across a dozen sets. The technical challenge of this
> project was: given a single phone photo, identify exactly which one of those twenty thousand cards
> it is. In the next ten minutes I'll walk through how I approached that, the models and algorithms I
> used, the problems I hit, and how I solved them."

**Recording cue:** Static title slide, or a 3-second clip of the app recognising a card behind a
dim overlay.

---

## Slide 2 — The Challenge   *(kicker: 0 · COLD OPEN)*

**Layout / visuals:** Title + 4 bullets. Optional right-side image: two visually near-identical
cards side by side (e.g. a Pokémon and its evolution, or the same card across two sets) to make the
"look-alike" point land.

**On-screen text (bullets):**
- 20,000+ cards — many near-identical: same frame, same layout, same Pokémon across many sets
- Goal: from a single phone photo, identify the **exact** card
- Real-world conditions: rotation, glare, background, blur
- Hard *precisely because* the classes look almost the same

**Narration:**
> "There are 20,000+ Pokémon cards and many look almost identical. The challenge was: given a messy
> phone photo — rotation, glare, background — identify exactly which one of 20,000 cards it is. I'll
> walk through the approach, the models, the problems, and the solutions."

**Recording cue:** Two near-identical card images side by side; circle the tiny differences.

---

## Slide 3 — Problem Framing → Retrieval, not Classification   *(kicker: 1 · APPROACH)*

**Layout / visuals:** Title + 5 bullets. Optional small diagram on the right:
`photo → [embed] → vector → nearest-neighbour → card`.

**On-screen text (bullets):**
- I have exactly **one** clean catalog image per card
- A 20,000-class classifier would need many labeled photos *per class* — which I don't have
- …and full retraining every time a new card is printed
- → Framed as **fine-grained instance retrieval**: card → vector → nearest neighbour
- Adding a new card = insert **one** vector. No retraining. *This decision shaped everything.*

**Narration:**
> "The framing drove every decision. I have one clean image per card, and I need to match a messy
> photo against twenty thousand near-identical classes. A twenty-thousand-class classifier would need
> many labeled photos per class — which I don't have — and retraining for every new card. So I framed
> it as instance retrieval: turn every card into a vector, store them, embed the photo at query time,
> and find its nearest neighbour. Adding a card is just inserting one vector. That single decision
> shaped the whole system."

**Recording cue:** Animate the little `photo → vector → nearest-neighbour → card` flow.

---

## Slide 4 — Architecture   *(kicker: 2 · SYSTEM)*

**Layout / visuals:** Title + the **Mermaid architecture diagram from
[`docs/architecture.md`](architecture.md)** as the hero visual (render it to an image), with the
service bullets down the side or below.

**On-screen text (bullets):**
- **Next.js** web app — front end + API
- **FastAPI** inference service — the computer vision
- **PostgreSQL + pgvector** — vector store & nearest-neighbour search
- **Trainer + MLflow** — index build, training, experiment tracking
- Optional: **Ollama** (local LLM) · **OCR + Qdrant** (text channel)
- **Caddy** reverse proxy → HTTPS on the LAN (camera needs a secure context)
- Runs on a **single CPU machine — no GPU**

**Narration:**
> "Architecturally it's a small set of Docker Compose containers. A Next.js app is the front end and
> API. A FastAPI service does the computer vision. Postgres with the pgvector extension stores the
> card vectors and does nearest-neighbour search. A trainer service with MLflow handles training and
> tracking. Optional services — a local Ollama LLM and an OCR-plus-Qdrant text channel — are opt-in.
> Everything sits behind a Caddy reverse proxy that gives me HTTPS on the LAN, which I need because
> the browser camera API only works over a secure connection. The whole thing runs on a single CPU
> machine — no GPU — and that constraint shows up throughout the design."

**Recording cue:** Show the rendered architecture diagram; optionally `docker compose ps` listing
the running services.

---

## Slide 5 — The Recognition Pipeline (a Cascade)   *(kicker: 3 · CORE)*

**Layout / visuals:** Title + 5 stage bullets in the upper half; a **results table** in the lower
half. This is the most important slide — give the table visual weight.

**On-screen text (bullets):**
- **1 · Deskew** — OpenCV: Canny → contours → quadrilateral → perspective warp (flatten the card)
- **2 · Embedding** — classical descriptor → **DINOv2-small** (ONNX, frozen, zero-shot)
- **3 · Learned head** — small MLP trained with **InfoNCE** metric learning on synthetic phone-photos (CPU)
- **4 · Geometric re-rank** — **ORB** features + **RANSAC** homography verify same artwork
- **5–6 · Fallbacks** — VLM (local Ollama / Claude) reads the card · OCR + Qdrant text match

**Table — "Embedding stage → recall@1" (3k-card synthetic-photo eval):**

| Embedding stage | recall@1 |
|---|---|
| Classical hand-crafted descriptor | 0.25 |
| DINOv2-small (frozen, zero-shot) | 0.75 |
| + learned projection head | 0.975 |
| + geometric re-rank | **0.99** |

**Narration:**
> "The recognition is a cascade, and each stage exists to fix a weakness of the previous one. First,
> deskew with OpenCV — detect the card edges and warp it flat. Second, the embedding, which is where
> the project really evolved. I started with a hand-crafted descriptor — about 0.25 recall@1, an
> honest but weak baseline. Switching to a frozen DINOv2 Vision Transformer, run through ONNX on CPU,
> tripled that to about 0.75 zero-shot. Third, I trained a small head with a contrastive metric-
> learning loss on synthetic phone-photos so a card's augmented views cluster around its reference —
> the backbone stays frozen, so it trains on CPU — and that reached 0.975. Fourth, because cards are
> flat rigid objects, I verify the top candidates with ORB features and a RANSAC homography, which
> lifts top-1 to about 0.99. Finally, for genuinely hard cases, a vision-language model or an OCR text
> channel can step in."

**Recording cue:** Show the four-row table animating in row by row; optionally a quick clip of the
deskew step (raw photo → flattened card).

---

## Slide 6 — Evaluation: Being Honest About Accuracy   *(kicker: 4 · EVALUATION)*

**Layout / visuals:** Title + 4 bullets + a second small **held-out** table. Tone: rigorous/honest.

**On-screen text (bullets):**
- My first eval rotated the catalog image and matched it against itself — near-circular, overstated accuracy
- Rebuilt it: **held-out synthetic photos**, embedded with the same model, **same NN query as production**
- Key question: did the head **memorise** training cards, or **learn** photo-invariance?
- **Held-out-CARD test** — train on one set of cards, evaluate on a completely different, unseen set:

**Table — "Unseen cards (never trained on) → recall@1":**

| Unseen cards (never trained on) | recall@1 |
|---|---|
| DINOv2-small (frozen, zero-shot) | 0.78 |
| + learned projection head | **0.97** |

**Narration:**
> "It's easy to fool yourself on accuracy. My first evaluation just rotated the catalog image and
> matched it against itself — almost circular, and it massively overstated accuracy. I threw it out
> and built a proper harness: generate held-out synthetic photos, embed them with the same model, and
> run the same nearest-neighbour query the live service uses. The bigger question was whether the head
> just memorised the cards it trained on. So I ran a held-out-card test — train on one set of cards,
> evaluate on a completely different set the head had never seen. On those unseen cards, recall@1 went
> from 0.78 zero-shot to 0.97 with the head. That proved it generalises: it learned the transformation,
> not the specific cards. It's the result I'm most confident about."

**Recording cue:** Show the held-out table; optionally a frame of a synthetic phone-photo next to its
clean reference to illustrate the augmentation.

---

## Slide 7 — MLOps   *(kicker: 5 · MLOps)*

**Layout / visuals:** Title + 6 bullets. Optional hero: a screenshot of the **MLflow UI** (runs +
metrics) or the **admin → MLOps** view.

**On-screen text (bullets):**
- **Config-driven pipeline:** ingestion → index build → evaluation
- **MLflow** — params / metrics / artifacts tracked per run
- **Model registry** — versioned `ModelVersion` rows in Postgres, shown in the admin dashboard
- **DVC** — the ~3 GB / 20k-image dataset is versioned; `dvc repro` makes the pipeline reproducible
- **Self-improving flywheel** — user confirmations become labels folded back into the index (active learning)
- **CI** — unit + end-to-end smoke + type-checks + a drift-guard; every feature shipped as a reviewed PR

**Narration:**
> "Because this is also an MLOps course, the engineering around the model matters as much as the model.
> Training is a config-driven pipeline, and every run logs parameters and metrics to MLflow and
> registers a versioned model entry in Postgres that the admin dashboard reads. The dataset — about
> three gigabytes — is versioned with DVC, and the whole pipeline is reproducible with `dvc repro`.
> There's a self-improving flywheel: when a user confirms or corrects a recognition, that becomes a
> label the trainer folds back into the index. And everything ships through CI — unit tests, an
> end-to-end smoke test, type-checks, and a guard against silent drift — as reviewed pull requests."

**Recording cue:** Screen-capture the MLflow runs list (`http://192.168.3.177:5000`) and/or the admin
MLOps page; show a green CI run on GitHub.

---

## Slide 8 — The LLM Layer   *(kicker: 6 · AI ASSISTANT)*

**Layout / visuals:** Title + 4 bullets. Optional hero: a screenshot of the **assistant** answering a
question about the collection.

**On-screen text (bullets):**
- **Collection assistant** — RAG grounded in *your* collection (stats, set completion, value in €)
- **Provider router** — local model via **Ollama** (cheap, private) ↔ **Claude** (capable), graceful fallback
- A deliberate **cost-vs-capability, local-vs-cloud** trade-off
- **LLM-as-judge** evaluation — scores groundedness: grounded answers **5/5**, hallucinated ≈ **1/5**

**Narration:**
> "On top of recognition there's a natural-language assistant. It builds a context from your actual
> collection — your stats, set completion, total value in euros — and answers questions about it: that's
> retrieval-augmented generation grounded in your own data. The interesting engineering is the provider
> router: it can run a local model through Ollama for cheap, private queries, or Claude for harder
> reasoning, with graceful fallback — a deliberate cost-versus-capability trade-off. And to keep it
> honest, I built an LLM-as-judge evaluation that scores whether answers are actually grounded in the
> data: grounded answers scored five out of five, deliberately hallucinated ones about one."

**Recording cue:** Screen-capture the assistant answering "How close am I to completing Base Set?" or
"What's my collection worth?"

---

## Slide 9 — Challenges & How I Solved Them   *(kicker: 7 · CHALLENGES)*

**Layout / visuals:** Title + 6 two-part bullets (problem → solution). Slightly smaller font; this is a
dense recap slide.

**On-screen text (bullets):**
- **One image per card** → synthetic augmentation + metric learning (no real labeled photos needed)
- **No GPU** → freeze backbone, train a tiny head; ONNX on CPU; apply the head in plain NumPy at inference
- **20k images in memory** → stream and embed one image at a time
- **Fooling myself on accuracy** → realistic, held-out evaluation
- **Reproducibility** → DVC for data + pipeline, pinned container images, CI guards
- **Methodology** → AI-assisted build, but I directed every decision and validated each step *(documented)*

**Narration:**
> "Quickly, the hardest problems and how I solved them. One image per card — solved with synthetic
> augmentation plus metric learning. No GPU — I freeze the backbone, train only a tiny head, run ONNX on
> CPU, and apply the trained head in plain NumPy at inference, so the serving path needs no deep-learning
> framework; memory on twenty thousand images is handled by streaming them one at a time. Fooling myself
> on accuracy — the held-out evaluation I described. Reproducibility — DVC, pinned images, and CI guards.
> And on methodology: I built this project working with an AI coding agent, but I directed every decision
> — the architecture, the trade-offs, what to build and in what order — and validated each step with
> tests and these evaluations. I'm transparent about that; it's documented in the repo."

> *(Optional: drop the last bullet/sentence if you'd rather not cover development methodology.)*

**Recording cue:** Static slide; let the narration carry it.

---

## Slide 10 — Summary   *(kicker: 8 · CLOSE)*

**Layout / visuals:** Title + 4 bullets + a closing "Thank you". Optional: re-show the recall
progression (0.25 → 0.99) as a small strip, and a final live scan clip.

**On-screen text (bullets):**
- Turned a **20,000-class problem into retrieval**
- Drove **recall@1 from 0.25 → 0.99**: frozen DINOv2 + learned metric-learning head + geometric verification
- **Proven to generalise** to unseen cards (0.78 → 0.97 held-out)
- Wrapped in **reproducible MLOps**: tracking, versioning, monitoring, and a self-improving feedback loop
- **Thank you!**

**Narration:**
> "To summarise: I turned a twenty-thousand-class recognition problem into a retrieval problem, drove
> accuracy from twenty-five percent to ninety-nine percent through a frozen DINOv2 backbone, a learned
> metric-learning head, and geometric verification — and I proved it generalises to cards it never
> trained on. Then I wrapped it in a reproducible MLOps pipeline with tracking, versioning, monitoring,
> and a self-improving feedback loop. Thanks for watching."

**Recording cue:** End on a live scan: photograph a card, show the correct result appear.

---

## Production tips

- **Slides as visuals:** the rendered Mermaid diagram from `architecture.md` (Slide 4) and the two
  result tables (Slides 5–6) are your strongest visuals — make them large.
- **Live captures to record up front:** (1) a card scan end-to-end, (2) the MLflow runs list, (3) the
  admin MLOps view, (4) the assistant answering a question, (5) a green CI run. Reuse across slides.
- **HTTPS for the camera:** open the app at `https://192.168.3.177` (Caddy serves a local cert) so the
  browser camera works during the demo capture.
- **Best-config check:** the box's `.env` is set to the production-best recognition config
  (`EMBEDDER=onnx`, `EMBED_HEAD=/models/head.npz`, `RERANK_TOP_K=10`, `VLM_ASSIST=1`) — keep it that way
  when recording so the results match the numbers above.
- **Timing:** ~1 minute per slide keeps you at ~10 minutes; Slides 5 and 6 (the core + the honesty
  argument) deserve the most time.
