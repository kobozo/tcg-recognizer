# Recognition Pipeline — Technical Reference

This document describes, stage by stage, how the TCG card recognizer turns a
photo of a single card into a ranked identity. For each stage it states **what**
it does, **how** (the actual algorithm and parameters in the code), and **why**
that approach was chosen — including the alternatives considered, the trade-offs,
and the measured effect on recall.

The recognizer is a **retrieval (nearest-neighbour) cascade**, not a fixed-class
classifier. The high-level responsible-AI summary, intended use, and limitations
live in the **[Model Card](MODEL_CARD.md)**; this document is the implementation
companion and does not duplicate that material.

End-to-end flow:

```
photo
  └─(1)─ deskew (OpenCV quad detect + perspective warp)
        └─(2)─ embed → 512-d vector   [classical descriptor | DINOv2 ONNX]
              └─(3)─ (+ learned projection head, applied in numpy)
                    └─(4)─ pgvector cosine nearest-neighbour over card_vectors → top-K shortlist
                          └─(5)─ geometric re-rank (ORB + RANSAC homography inliers)   [optional]
                                └─(6)─ VLM disambiguation, gated on low confidence      [optional]
                                      └─(7)─ OCR + pgvector text channel (complementary)  [optional]
                                            → ranked candidates the user confirms
```

Orchestration: the inference service (`services/inference/app/main.py`,
`/predict`) runs stages 1–5; the web app (`apps/web/app/api/scan/route.ts`,
`POST /scan`) calls inference and then layers stages 6 (VLM) and 7 (OCR) on top
before persisting the scan. The index that stage 4 searches is built offline by
the trainer (`services/trainer/src/pipelines/training.py`).

---

## 1. Card detection / deskew

**What.** Find the card inside the photo and perspective-warp it to a fixed
upright portrait rectangle (360 × 504 px, the ~2.5 × 3.5 card aspect ratio)
before anything else looks at it.

**How** (`services/inference/app/embedding.py`, `deskew()`):

1. Convert to grayscale, Gaussian-blur with a 5×5 kernel to suppress texture
   noise.
2. **Canny** edge detection with hysteresis thresholds `50 / 150`.
3. **Dilate** the edge map with a 3×3 kernel (1 iteration) to close small gaps so
   the card outline forms one closed contour.
4. `findContours` with `RETR_EXTERNAL` + `CHAIN_APPROX_SIMPLE`.
5. For each contour: discard anything smaller than **5 % of the image area**
   (specks and noise); approximate the polygon with `approxPolyDP` at
   `0.02 · perimeter`; keep it only if it is a **4-point convex** quad, and track
   the **largest by area**.
6. Order the 4 corners (TL, TR, BR, BL) via the classic x+y / y−x argmin/argmax
   trick (`_order_quad`), compute the homography with
   `getPerspectiveTransform`, and `warpPerspective` to the canonical
   360 × 504 rectangle.

The function is wrapped so it **never raises**: if no good quad is found (busy
background, card bleeding off-frame), it returns the original image unchanged and
the pipeline continues.

**Why.** The embedder (stage 2) is **not** rotation- or perspective-invariant —
the classical descriptor is explicitly *spatial* (it encodes *where* colour and
structure sit on the card), and even the DINOv2 backbone degrades when the
subject is rotated, skewed, or surrounded by background clutter. Normalising
every photo to the same canonical frame **before** embedding means the query
vector lands in the same region of embedding space as the clean reference image
that was indexed, which is the whole basis for nearest-neighbour matching.
Deskewing also lets the synthetic-photo augmenter (`photo_aug`) assume the card
*fills the frame* and skip background compositing, keeping training and inference
consistent.

*Alternatives:* a learned object detector / segmentation model (e.g. an SSD or a
U-Net for corner regression) would be more robust to occlusion, but needs labels,
training, and GPU/CPU budget this project deliberately avoids. The classical
Canny→contour→quad approach is zero-cost, deterministic, dependency-light
(OpenCV only), and exploits the strong prior that a card is a high-contrast
convex quadrilateral — a good fit for the "well-framed single card" assumption.

---

## 2. Embeddings — two interchangeable backends

A single function, `embed(pil) -> list[512 floats]`
(`services/inference/app/embedding.py`, byte-for-byte duplicated in
`services/trainer/src/embedding.py`), produces an L2-normalised 512-dimensional
vector. The duplication is intentional: inference and trainer are separate Docker
build contexts that **must agree exactly** on the embedding, otherwise pgvector
nearest-neighbour search between the indexed references and the query would be
meaningless. The backend is selected by the env var **`EMBEDDER`**
(`classical` default, or `onnx`).

### 2a. Classical hand-crafted descriptor (default, `EMBEDDER=classical`)

**What.** A deterministic 512-d visual descriptor computed with pure
numpy/OpenCV/Pillow — no model, no network, no GPU.

**How** (`_embed_classical`): resize the deskewed RGB image to 224×224 with an
explicit **nearest-neighbour** resample, compute grayscale
(`0.299R + 0.587G + 0.114B`), then concatenate four feature groups:

| Group | Feature | Dims |
|---|---|---|
| (a) | **4×4 spatial grid**: per-cell mean R, G, B (÷255) **+** per-cell grayscale std (÷128) → 16 cells × 4 | 64 |
| (b) | **Mean-subtracted 18×18 grayscale block** (downsampled, then minus its own mean, ÷128) | 324 |
| (c) | **Per-channel colour histograms**: 3 channels × 16 bins, area-normalised | 48 |
| (d) | **Gradient-orientation histogram**: 36 bins, magnitude-weighted (HOG-like), central-difference gx/gy | 36 |

Total = **472 features**, zero-padded to 512, then L2-normalised.

**Why spatial, not global.** TCG cards share a near-identical border/frame and
layout; purely *global* colour or orientation histograms barely separate one card
from another because the dominant signal (the frame) is shared. So the descriptor
is deliberately **spatial**: group (a) encodes *where* colours and contrast sit
(grid cells), and group (b) is a low-resolution but *positionally aligned*
thumbnail of the artwork that survives brightness changes (mean subtraction).
Groups (c)/(d) add global colour and edge-orientation cues that are cheap and
complementary. Mean subtraction in (b) and the std term in (a) buy
brightness-invariance for free.

*Why have it at all:* it is the **zero-dependency baseline / fallback**. It needs
no model download and runs anywhere, so the service is always available even with
no network. It is also the honest baseline against which the learned backend is
measured (recall@1 = **0.247**, see §8).

### 2b. DINOv2-small via ONNX (learned, `EMBEDDER=onnx`)

**What.** A learned image embedding from **DINOv2-small (ViT-S/14)**, used
**frozen and zero-shot** — taken as released, never fine-tuned.

**How** (`_ensure_onnx`, `_preprocess_onnx`, `_embed_onnx_raw`):

- The model (`Xenova/dinov2-small`, `onnx/model.onnx`) and its
  `preprocessor_config.json` are **lazily downloaded once** from the Hugging Face
  hub into `$MODEL_DIR/onnx/dinov2-small/` and cached. Loaded once via
  `onnxruntime` `InferenceSession` with the `CPUExecutionProvider`
  (thread-count from `ORT_THREADS`).
- Preprocessing mirrors the HF DINOv2 image processor exactly: resize shortest
  edge to 256 (bicubic), center-crop 224×224, scale to [0,1], normalise with
  ImageNet mean/std.
- Run the graph, take the **CLS token** of `last_hidden_state` (index 0 along the
  token axis), then `_fit_512`: L2-normalise → pad/truncate to exactly 512 →
  L2-normalise again. DINOv2-small's hidden size is 384, so the vector is
  zero-padded up to 512 to keep the **`vector(512)`** pgvector schema unchanged.
- **Graceful degradation:** any download/load/inference failure logs and falls
  back to the classical descriptor (`used_onnx=False`); `_embed_onnx_raw` never
  raises, so `/predict` stays available.

**Why a self-supervised ViT backbone.** DINOv2 is trained self-supervised on a
very large unlabeled corpus (LVD-142M) and produces general-purpose visual
features that cluster semantically similar images together **without any
task-specific labels**. That is exactly what a retrieval recognizer needs: a
metric space where a photo of a card lands near the same card's reference.
Crucially it is **zero-shot for us** — we never see card labels at backbone
training time, so adding a brand-new card needs no retraining (it just gets
indexed). This lifts recall@1 from the classical baseline's **0.247** to
**0.750** (§8).

**Why frozen.** Fine-tuning a ViT needs a GPU, labels, and risks overfitting the
~3k-card sample; this box is CPU/RAM-tight. Keeping the backbone frozen and
pushing all task adaptation into a tiny head (§3) is the deliberate trade-off.

**Why ONNX / onnxruntime.** ONNX is a portable, framework-agnostic graph that
runs efficiently on CPU via onnxruntime with **no torch dependency at inference**
— important for a slim, CPU-only service. It also enables the on-device parity
below: the same ONNX model runs in the browser.

### On-device (browser) parity

Both backends have a TypeScript port so an embedding computed in the user's
browser matches the server's index exactly:

- **Classical** (`apps/web/lib/clientEmbedding.ts`): a bit-for-bit
  reimplementation. To stay byte-identical it copies the Python's nearest-neighbour
  index math (`src = floor(dst·srcSize/dstSize)`), the `0.299/0.587/0.114`
  grayscale weights, the uint8 truncation before the 18×18 block, the
  `min(floor(v·16/255), 15)` histogram binning, and the same concatenation
  order/padding. (This is why the Python `embed()` deliberately uses an explicit
  nearest-neighbour resample instead of PIL bilinear — bilinear is not trivially
  portable to JS.)
- **DINOv2** (`apps/web/lib/onnxEmbedding.ts`): runs the **same**
  `Xenova/dinov2-small` model via **transformers.js**, prefers **WebGPU** with
  automatic fallback to **wasm** (CPU), takes the same CLS token, and applies the
  same `fit512`. Gated by `NEXT_PUBLIC_EMBEDDER === "onnx"`.

When the client supplies a precomputed embedding, `/predict` validates it (JSON
array of exactly `EMBED_DIM=512` finite floats) and **skips server-side vision
work entirely** (`_parse_embedding` in `main.py`), going straight to the vector
lookup. *Why:* it offloads the expensive vision step to the client and saves a
round-trip of pixels; parity is what makes this safe.

---

## 3. Learned projection head (sub-project 3)

**What.** A small MLP trained with **metric learning (InfoNCE)** on top of the
frozen DINOv2 embeddings, to make a card's *phone-photo* views land close to its
*clean reference* view. The backbone stays frozen; only this tiny head trains.

**How** (training: `services/trainer/src/train_head.py` +
`services/trainer/src/pipelines/train_head.py`; application:
`_load_head` / `_apply_head` in `embedding.py`):

- **Architecture:** `Linear(d→d) → ReLU → Linear(d→d)`, output L2-normalised
  (d = 512).
- **Two deliberately-separated phases** so onnxruntime and torch are never both
  resident (RAM is tight):
  1. `precompute()` — DINOv2-embed each training card's reference **plus
     `HEAD_VIEWS` (default 5) synthetic phone-photos** of it (from `photo_aug`,
     §3.1) → `head_features.npz` (`ref`, `aug` arrays). Uses **onnxruntime only**,
     with `EMBED_HEAD` explicitly unset so it captures *raw frozen* features.
  2. `train()` — load the features and train the head with **torch on CPU**.
- **Loss — symmetric InfoNCE with in-batch negatives:** for a batch, the anchor
  is a *random augmented view* of each card and the positive is that card's clean
  reference; `logits = anchor · refᵀ / temp` and the loss is the average of
  `cross_entropy(logits)` and `cross_entropy(logitsᵀ)` against the diagonal
  labels. Every *other* card in the batch is an implicit negative. Defaults:
  `HEAD_TRAIN_CARDS=3000`, `HEAD_VIEWS=5`, `HEAD_EPOCHS=40`, `HEAD_BATCH=256`,
  `HEAD_TEMP=0.05`, `HEAD_LR=0.001` (Adam).
- **Saved as numpy** (`head.npz`: W1, b1, W2, b2). At inference it is **applied in
  pure numpy** (`_apply_head`: `relu(x·W1+b1)·W2+b2`, then `_fit_512`), so the
  inference path needs **no torch**. Enabled with `EMBED_HEAD=/models/head.npz`.
  Critically, `embed()` applies the head **only when DINOv2 genuinely produced the
  vector** (`used_onnx=True`) — a per-call fallback to the classical descriptor
  must not be fed through a DINOv2-trained head.

### 3.1. Synthetic phone-photo augmentation (`photo_aug.make_photo`)

The shared augmenter (`services/trainer/src/pipelines/photo_aug.py`) turns a
clean catalogue image into a realistic snapshot, **deterministically per seed**.
Applied in order: (1) **perspective warp** (corners jittered ±8 %), (2) small
**in-plane rotation** (±8°), (3) a **radial glare** spot, (4) **brightness/
contrast** jitter, (5) **hue/saturation** jitter, (6) **mild Gaussian blur** (70 %
of the time), (7) **JPEG recompression** at quality 40–85. It is the single
engine shared by both the head training (many views per card) and the evaluation
harness (held-out views).

**Why a head, and why this head.** The frozen DINOv2 space is strong but *not
tuned to be invariant to phone-photo conditions* — glare, perspective, blur, JPEG
artifacts push a photo away from its clean reference. Metric learning explicitly
optimises for exactly that invariance: pull augmented views toward the reference,
push different cards apart. InfoNCE with in-batch negatives is the standard,
sample-efficient choice (it reuses the batch as a large negative set, no explicit
negative mining). Keeping the head tiny and the backbone frozen means the whole
thing **trains on CPU** in minutes, fitting the project's hardware budget.

**Why it's a genuine improvement (generalization).** The key risk is that the
head merely *memorises the 3k cards it trained on*. The held-out eval
(`scripts/eval-heldout.sh`, via `SAMPLE_OFFSET` indexing a **disjoint** card
range the head never saw) refutes that: on cards **4000–5500**, the head still
lifts recall@1 from **0.782 → 0.973** (§8). It learned photo-invariance, not card
identities — so it transfers to new cards with no retraining. On the in-sample 3k
eval it lifts **0.750 → 0.975**.

---

## 4. Vector search (pgvector cosine NN)

**What.** Retrieve the top-K most similar indexed cards to the query embedding.

**How.** The trainer (`services/trainer/src/pipelines/training.py`, `build_index`)
embeds every catalogue image and stores it in Postgres
(`CREATE EXTENSION vector`) in a `card_vectors(... , embedding vector(512))`
table, replacing the rows for a game on each rebuild. Ingestion
(`pipelines/ingestion.py`) feeds it from a local manifest (the full ~20k
catalogue, loaded lazily by path to bound memory), with API and synthetic
fallbacks; `sample_offset`/`sample_size` carve out card ranges (this is what
powers the held-out eval).

At query time (`main.py`, `_query_index`) the service runs:

```sql
SELECT card_id, name, set_name, number, rarity, type, image_url,
       1 - (embedding <=> %s::vector) AS sim
FROM card_vectors WHERE game = %s
ORDER BY embedding <=> %s::vector LIMIT %s;
```

`<=>` is pgvector's **cosine distance**; `1 - distance` is reported as the match
confidence. The top result becomes `name.value`; the top 3 become the candidate
shortlist. Every DB problem (no `DATABASE_URL`, missing table, zero rows) falls
back to a per-game stub so `/predict` never 500s.

**Why retrieval, not a softmax classifier.** A fixed-class classifier would need
one output node per card and **retraining every time a card is added** — untenable
for a ~20k catalogue that grows with every new set. With retrieval, **adding a
card is just inserting one row**: index its reference embedding and it's instantly
searchable, no retraining, no label-set churn. It also naturally returns a
*ranked shortlist* (what the human-in-the-loop UX needs) and a calibrated-ish
similarity score. pgvector specifically lets the index live in the same Postgres
the app already uses (no separate vector DB to operate), and cosine distance is
the right metric for the L2-normalised embeddings every backend produces.

---

## 5. Geometric re-ranking (ORB + RANSAC)

**What.** Re-order the embedding shortlist by a strict geometric **same-artwork**
test, to fix cases where a look-alike out-ranks the true card.

**How** (`services/inference/app/rerank.py`, identical to
`services/trainer/src/pipelines/rerank.py`; wired in via `_maybe_rerank` in
`main.py`, enabled by `RERANK_TOP_K > 0`):

- For each top-K candidate, load its reference image, detect **ORB** features
  (`nfeatures=600`) on both query and reference (downscaled to 320 px long edge),
  match with a **brute-force Hamming** matcher + **Lowe ratio test** (0.75).
- If ≥ 8 good matches, fit a **homography with RANSAC** (`findHomography`,
  reproj threshold 5.0) and count the **inliers**.
- Sort the shortlist by inlier count (stable on ties by original embedding rank);
  candidates beyond top-K keep their order. Best-effort: if reference images
  aren't mounted or anything fails, the embedding order is returned unchanged.

**Why it works.** Cards are **flat, rigid, planar** objects, so a single
homography fully models the geometric relationship between a photo of a card and
its reference image. The true card produces **many RANSAC-consistent**
correspondences; a different card with the same frame produces few. This is a far
stronger exact-match signal than embedding cosine for *visually similar but
distinct* cards (evolution stages, reprints, alternate printings) — the dominant
error mode. It is pure OpenCV: **no GPU, no extra model, no network**.

**Why it can only help (and what it lifts).** Re-ranking only reorders the
existing top-K, so it can promote any true card *already in the top-K* to rank 1
— it lifts recall@1 toward the embedding's recall@K, and cannot lower recall@K.
Measured: on the 3k eval it takes DINOv2+head from **0.975 → 0.998**, and even
lifts the zero-shot DINOv2 baseline to recall@1 ≈ **0.917**; on the held-out eval
**0.973 → 0.990** (§8).

---

## 6. VLM-assisted disambiguation (gated)

**What.** On *uncertain* shortlists, a vision-language model **reads the card's
printed text** and picks the matching name from the shortlist.

**How** (`apps/web/lib/vlm.ts`, orchestrated in
`apps/web/app/api/scan/route.ts`):

- **Gated twice:** only runs when `VLM_ASSIST` is on **and** the recognizer is
  uncertain — specifically when `predictions.name.conf < 0.6` (the same threshold
  the UI uses to surface candidates). A confident recognition is never
  overwritten.
- Sends the photo + a prompt listing the candidate names to a vision model via a
  provider abstraction (`chatVisionRouted`) that prefers **Claude vision** when
  keyed, else a **local Ollama vision model** (e.g. llava); off by default so CI
  and the default stack never call a model. `VLM_MAX_TOKENS` (160) and
  `VLM_TIMEOUT_MS` (60 s) keep slow local models bounded.
- The reply is parsed leniently (`parseVlmJson` strips code fences / extracts the
  first `{…}`; `matchCandidateInText` recovers a name from prose like "This is a
  Blastoise card").
- **Constrained:** the pick is accepted **only if it is one of the candidates**
  (`matchCandidate`, case-insensitive). An off-list guess is rejected and the
  existing top prediction is kept. Never throws; a no-op when disabled or on any
  error/timeout.

**Why multimodal fusion helps hard cases.** The visual embedding can confuse
cards with near-identical artwork but *different printed text* (collector number,
HP, set symbol). A VLM reads that text — a fundamentally different, complementary
signal — and breaks the tie. Constraining the pick to the shortlist means the VLM
can only *re-rank within candidates the retrieval stage already trusts*, so it
adds precision on genuinely ambiguous cases without introducing free-form
hallucinations. Gating on low confidence keeps the slow/expensive model off the
common easy path.

---

## 7. OCR + pgvector text channel (complementary signal)

**What.** An opt-in printed-text match: OCR the card, search a text index, and
fold the hits in as **extra name candidates**.

**How** (`services/ocr/app/main.py`; client `apps/web/lib/ocrChannel.ts`; wired in
`scan/route.ts`):

- **OCR:** `pytesseract.image_to_string` on the uploaded image
  (`POST /ocr_search`). Any failure returns empty results (never 500s).
- **Text embedding** (`text_embed`): a **deterministic, model-free 256-d**
  vector. Lowercase + strip to `[a-z0-9 ]`, then hash **whole tokens** and
  **character 3-grams** into 256 buckets (counts) using a stable FNV-1a hash,
  L2-normalised. The 3-gram features make it robust to OCR noise / partial reads
  (a query "charizard" still overlaps a doc "charizard 4/102 base fire").
- **Search:** **Postgres + pgvector** cosine NN over the `card_text_vectors`
  table (`vector(256)` per card, `ORDER BY embedding <=> %s::vector`), filtered by
  game — the **same store and operator the core recognizer uses** (no separate
  vector DB). The index is built by `/reindex` (stable per-card ids so re-runs
  upsert in place). Results are turned into deduped candidates with the cosine
  score as confidence (`ocrResultsToCandidates`) and merged into the shortlist
  without duplicating the primary name (`mergeOcrCandidates`).
- Gated by `OCR_ENABLED` (Docker Compose `extras` profile); off by default,
  8 s timeout, never throws — recognition does not depend on it.

**Why a complementary channel + the flywheel.** Printed text is independent of
the visual embedding, so it catches cards the image channel ranks poorly. The
text embedder is deliberately **deterministic and model-free** (hashed n-grams),
so it needs no model, no GPU, and is reproducible. Most importantly it **feeds the
self-improving flywheel** (see Model Card): when the user confirms or corrects a
scan against the merged shortlist, that real-photo→name pair becomes a `Feedback`
row the trainer folds back into the `card_vectors` index
(`incorporate_feedback`), adapting the index to real-world photo conditions the
synthetic augmentations only approximate. The OCR channel is one way that
human-confirmed signal enters the loop.

---

## 8. Measured recall progression

These numbers come from the evaluation harness
(`services/trainer/src/pipelines/evaluation.py`), which is **honest by
construction**: for each evaluated card it generates **held-out** synthetic
phone-photos (via `photo_aug.make_photo`, *not* the reference image), embeds them
with the **same** embedder used to build the index, runs the **same** pgvector
query the inference service uses, and records the rank of the true card. (This
replaced an earlier near-circular eval that matched a slightly-rotated reference
against itself.) All figures are cited from the **[Model Card](MODEL_CARD.md)**.

**Headline (Pokémon, 3k-card index subset, synthetic-photo eval):**

| System | recall@1 |
|---|---|
| Classical colour/gradient descriptor | 0.247 |
| DINOv2-small (frozen, zero-shot) | 0.750 |
| DINOv2 + learned head | 0.975 |
| DINOv2 + learned head + geometric re-rank | 0.998 |

Geometric re-rank also lifts the zero-shot DINOv2 baseline to recall@1 ≈ 0.917.

**Held-out-CARD generalization** (head trained on the first ~3k cards; evaluated
on cards **4000–5500**, which the head *never saw*; via `scripts/eval-heldout.sh`):

| System (cards UNSEEN by the head) | recall@1 | recall@5 | recall@10 |
|---|---|---|---|
| DINOv2-small (frozen, zero-shot) | 0.782 | 0.927 | 0.943 |
| DINOv2 + learned head | **0.973** | 1.000 | 1.000 |
| DINOv2 + learned head + geometric re-rank | **0.990** | 1.000 | — |

The head lifting recall@1 from **0.78 → 0.97 on cards it never trained on** is the
evidence that it learned photo-invariance rather than memorising identities.

**Reading the progression:** each stage attacks a different failure mode — the
learned backbone fixes "generic features aren't discriminative enough" (0.25 →
0.75), the head fixes "not invariant to phone-photo conditions" (0.75 → 0.97/0.98),
and geometric re-rank fixes "look-alikes out-rank the true card in the top-K"
(→ 0.99+). The VLM and OCR channels (§6–§7) target the residual hard cases and
are not part of the headline recall table.
