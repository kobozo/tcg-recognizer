# Data & Evaluation

This document explains **what data the TCG Card Recognizer uses** and **how and
why it is evaluated**. Every claim is grounded in the repository; file paths are
cited inline. It complements the responsible-AI cards — the
**[Data Card](DATA_CARD.md)** (provenance, licensing, schema) and the
**[Model Card](MODEL_CARD.md)** (the model pipeline and headline results) — and
focuses on the data engineering and the evaluation methodology rather than
repeating those cards.

---

## 1. Data sources

### 1.1 Pokémon TCG API — the primary catalogue

The recognizer's index is built from the full official Pokémon Trading Card Game
catalogue, sourced from the public **Pokémon TCG API**
(`https://api.pokemontcg.io/v2/cards`).

The downloader is `services/trainer/src/pipelines/download.py`, driven by the CLI
entry point `services/trainer/src/download.py` and the convenience wrapper
`scripts/download-cards.sh`. Key properties (all in `download.py`):

- **Full pagination.** `fetch_all_metadata()` pages the catalogue at the API
  maximum of 250 cards per request (`PAGE_SIZE = 250`), requesting only the
  fields it needs via `select=id,name,set,number,rarity,types,images`
  (`SELECT`). It loops until the API reports it has returned `totalCount` rows.
- **Scale.** On the download captured in this repo the catalogue is **~20,359
  cards**; **~20,306 reference images** are actually present on disk (a small
  number of catalogue entries have no usable image and are dropped), totalling
  **~3.2 GB**. The committed manifest currently has **20,307 rows**
  (`wc -l ml/datasets/pokemon/manifest.jsonl`).
- **Resumable.** `_download_one()` skips any destination file that already exists
  and is non-empty (`os.path.exists(dest) and os.path.getsize(dest) > 0`
  → returns `"skip"`), so an interrupted run continues where it left off. Images
  are written to a `.part` temp file and atomically `os.replace`d into place, so
  a crash never leaves a half-written PNG.
- **Metadata cache.** The paged metadata is written once to
  `<game>/cards_meta.jsonl` and reused on subsequent runs
  (`download_all()` → `_load_meta_cache()`), so a re-run never re-pages the whole
  catalogue. Crucially, a **truncated** metadata cache is *not* persisted: if a
  page permanently fails, pagination stops, `complete=False`, and the partial
  cache is deliberately discarded (`download.py:133-144`) so a broken run can
  never silently become the canonical dataset.
- **Resilient.** `_session()` configures `urllib3` `Retry` (5 attempts,
  exponential backoff, retry on 429/5xx). `_get_page()` adds a second per-page
  retry loop because the API intermittently returns 404 for a valid page under
  load. Image fetches run concurrently in a `ThreadPoolExecutor`
  (`DOWNLOAD_WORKERS`, default 16); every failure is tolerated per-card and the
  run reports `ok` / `skip` / `fail` counts.
- **Manifest integrity.** `write_manifest()` only emits rows for cards whose
  image is actually present and non-empty on disk (`_on_disk()` guard in
  `download_all()`), so the manifest never references a missing image.

The dataset is downloaded **once** and reused offline for every training and
evaluation run — no train-time API calls. It lives outside the repo under the
git-ignored `ml/datasets/` (mounted into the trainer at `$DATASET_DIR`, default
`/data`) and is **DVC-tracked** (only a small `ml/datasets/pokemon.dvc` pointer
is committed; see [docs/dvc.md](dvc.md)).

### 1.2 The web app's multi-game data abstraction

The web app reads card metadata and live market value through a small game
abstraction (`apps/web/lib/games/`), so the system is not hard-wired to one TCG.
`types.ts` defines a `GameProvider` interface (`listSets`, `getSet`,
`getSetCards`, `enrich`); `index.ts` registers providers and gates them behind an
`ENABLED_GAMES` flag.

- **Pokémon** (`apps/web/lib/games/pokemon.ts`) uses the same Pokémon TCG API
  (`https://api.pokemontcg.io/v2`).
- **Magic: The Gathering** (`apps/web/lib/games/magic.ts`) uses the
  **Scryfall API** (`https://api.scryfall.com`, free, no key). Sets and cards are
  paged (bounded to ~4 pages); this demonstrates the abstraction generalizes
  beyond Pokémon. (The *image index* in this deployment is populated for Pokémon;
  Magic is wired through the same interface.)

### 1.3 EUR pricing source

`enrich()` looks up market value. The deployment is based in Belgium, so the
preferred currency defaults to **EUR** (`preferredCurrency()` in
`games/types.ts`, overridable via `PREFERRED_CURRENCY`):

- **Pokémon** (`pokemon.ts:108-129`) reads **Cardmarket** (`cardmarket.prices`,
  the European marketplace — `trendPrice`, else `averageSellPrice`) for the EUR
  value, falling back to TCGplayer USD only when no EUR price exists.
- **Magic** (`magic.ts:108-135`) reads Scryfall's `prices.eur`, falling back to
  `usd`/`usd_foil`.

### 1.4 Licensing / IP note

Card images and names are © The Pokémon Company International / Nintendo / Game
Freak / Creatures Inc. (and Wizards of the Coast for Magic). The APIs
redistribute them for developer use; this project uses them **solely for card
recognition and educational coursework**, never for redistribution or commercial
use. The image files are deliberately **not** committed to git — anyone
reproducing this must download them under the APIs' terms. Full details are in
the **[Data Card](DATA_CARD.md#licensing--intended-use-ip-note)**.

---

## 2. Dataset structure

### 2.1 The manifest

Each card is one JSON object per line in
`<DATASET_DIR>/<game>/manifest.jsonl` (written by
`download.py:write_manifest()`). Example row (real, from the repo):

```json
{"card_id": "hgss4-1", "name": "Aggron", "set_name": "HS—Triumphant",
 "number": "1", "rarity": "Rare Holo", "type": "Metal",
 "image_url": "https://images.pokemontcg.io/hgss4/1.png",
 "image_path": "pokemon/images/hgss4-1.png"}
```

| Field | Type | Meaning |
|---|---|---|
| `card_id` | string | Stable API id (e.g. `base1-4`), also the index key. |
| `name` | string | Card name (recognition target). |
| `set_name` | string | Set / expansion name. |
| `number` | string | Collector number within the set. |
| `rarity` | string | Rarity (may be empty). |
| `type` | string | Primary type (may be empty). |
| `image_url` | string | Source URL of the cached image. |
| `image_path` | string | Repo-relative path to the cached PNG. |

### 2.2 Image storage

Images are stored as PNG under `<DATASET_DIR>/<game>/images/<safe_card_id>.png`.
The filename is the card id with non-`[A-Za-z0-9_.-]` characters replaced
(`_safe_name()` in `download.py`). `IMAGE_SIZE` selects the API's `small`
(default) or `large` render.

### 2.3 How the index is built from the manifest

The **ingestion** stage (`services/trainer/src/pipelines/ingestion.py`) assembles
the card list that becomes the search index. It has a clear source precedence:

1. **Local manifest** (`_ingest_from_manifest`) — the normal path. It reads the
   manifest line by line, resolves each `image_path` to an absolute path,
   and **only keeps rows whose image is present and non-empty on disk**
   (`os.path.exists(...) and os.path.getsize(...) > 0`). Images are loaded
   **lazily** at use time (`load_image()` opens the file on demand), so a
   20k-card dataset never sits decoded in memory.
2. **Live API sample** (`_ingest_from_api`) — fetches `sample_size` cards in
   memory when no local dataset is present.
3. **Synthetic fallback** — coloured placeholder images, so a rebuild never
   hard-fails.

Two `config.yaml` knobs control which cards are taken (both overridable by the
matching `UPPER_SNAKE` env var):

- **`sample_size`** — `"all"`/`0` indexes every manifest card; an integer caps
  the run (e.g. a 3,000-card subset baseline).
- **`sample_offset`** — skips the first *N* resolvable manifest cards before
  taking `sample_size`. This is the mechanism that makes the **held-out-card**
  evaluation honest (§4.3): it lets the indexed/evaluated card range be
  *disjoint* from the learned head's training cards.

Each card embedding is then inserted into the pgvector table `card_vectors` keyed
by `"<game>:<card_id>"` — the index the inference service queries at runtime.

---

## 3. Synthetic phone-photo augmentation

A user photographs a card; the system has only **one clean reference render per
card** to match against. There is no corpus of real labelled phone-photos. So the
project closes that domain gap synthetically: it manufactures realistic
phone-photo views from the clean reference and uses them both to *train* the
learned head and to *evaluate* honestly.

The generator is `make_photo(pil_image, seed)` in
`services/trainer/src/pipelines/photo_aug.py`. It is **deterministic per seed**
(`np.random.default_rng(seed)`), so evaluations are reproducible and runs are
comparable. The card is assumed to fill the frame (the `/predict` path deskews
first), so no background compositing is done. Applied in order:

1. **Perspective warp** — the four corners are jittered by up to ±8 % of the
   side length (`m = 0.08`) and `cv2.warpPerspective` is applied, simulating a
   hand-held viewing angle.
2. **In-plane rotation** — a small random rotation in ±8° (`cv2.warpAffine`).
3. **Glare** — a bright radial spot at a random location, intensity 40–120,
   simulating a light reflection on the card surface / sleeve.
4. **Brightness / contrast jitter** — `alpha ∈ [0.8, 1.2]`, `beta ∈ [-25, 25]`.
5. **Hue / saturation jitter** — hue shifted ±5, saturation scaled ×[0.85, 1.15]
   in HSV space.
6. **Mild blur** — a 3×3 or 5×5 Gaussian blur, applied with 70 % probability
   (most phone shots are not perfectly sharp).
7. **JPEG recompression** — re-encoded at quality 40–85, reproducing compression
   artifacts of a real captured/shared image.

**Why this is the right call.** With one reference per card, a conventional
train/val/test image split is impossible — there is nothing to hold out per
class. Synthetic augmentation is also the natural fit for this task:

- It directly models the **deployment regime** (the messy capture conditions a
  retrieval recognizer actually faces), rather than the clean renders.
- It supplies the **many positive views per card** that metric-learning needs to
  teach the head photo-invariance (sub-project 3), without any manual labelling.
- Being **seeded**, the same photo is regenerated bit-for-bit, so eval numbers
  are reproducible and the held-out photos are guaranteed never to coincide with
  the stored reference image.

`photo_aug` is the **single shared engine** for both the head training and the
evaluation harness (its module docstring), which keeps train-time and eval-time
augmentation identical.

---

## 4. Evaluation methodology

### 4.1 The recall@k harness

Evaluation is `services/trainer/src/pipelines/evaluation.py` →
`evaluate(items, index_count, cfg)`. The design goal is an **honest** measurement
that mirrors what happens at inference time. For each evaluated card it:

1. Loads the clean reference image (`load_image`).
2. Generates `eval_views` **held-out synthetic phone-photos** with
   `make_photo(base, seed=base_seed + idx*100 + v)` — never the reference image
   itself.
3. Embeds each photo with the **same `embed()`** used to build the index.
4. Runs the **same pgvector nearest-neighbour query the inference service uses**:
   `SELECT id FROM card_vectors WHERE game = %s ORDER BY embedding <=> %s::vector
   LIMIT %s` (cosine distance operator `<=>`).
5. Records the rank at which the true card id appears → increments
   `hit1 / hit5 / hit10`.

Final metrics are `recall_at_1`, `recall_at_5`, `recall_at_10`, plus
`eval_queries`, `eval_cards`, `eval_views`, `dataset_size`, `dim`.

**Why it replaced the old eval.** The previous harness merely rotated the
reference image ~7° and matched it against itself — an almost-circular test that
overstated accuracy (documented in the docstrings of both `evaluation.py` and
`photo_aug.py`). The current harness embeds a genuinely *different*,
photo-degraded view through the exact production query path, so the number means
"would the deployed system find this card from a realistic photo?".

### 4.2 Stride sampling

To evaluate cards evenly across the whole catalogue rather than a contiguous
block, `evaluate()` stride-samples the eval set:
`sample = [items[int(i * n / k)] for i in range(k)]` where `k =
min(eval_cards, n)` (`evaluation.py:42-43`). This spreads the evaluated cards
across sets/series so the score is not biased toward one region of the catalogue.
The eval is fully parametrised by `eval_cards`, `eval_views`, `eval_seed` in
`config.yaml`.

### 4.3 Held-out-CARD evaluation (the generalization question)

The learned head was trained on a stride sample of the **first ~3,000 manifest
cards**. Evaluating on those same cards measures *fit*, not *generalization*.
`scripts/eval-heldout.sh` answers the real question: using `SAMPLE_OFFSET` it
indexes and evaluates a card range **disjoint** from the head's training set
(default `SAMPLE_OFFSET=4000`, `SAMPLE_SIZE=1500` → cards ~4000–5500, which the
head never saw). It runs the eval **twice** — once with the head
(`EMBED_HEAD=/models/head.npz`), once zero-shot (`EMBED_HEAD=""`) — and prints a
recall@1/@5/@10 comparison. The invariant `HEAD_TRAIN_CARDS < SAMPLE_OFFSET`
keeps the eval cards genuinely unseen. The `sample_offset` plumbing in
`ingestion.py` (skip the first *N* resolvable cards) is what makes this disjoint
split possible.

### 4.4 The baseline-comparison script

`scripts/eval-baselines.sh` is the sub-project-1 comparison harness. For each
embedder in `EMBEDDERS` (default `classical onnx`) it **rebuilds** the
`card_vectors` index with that embedder (the index vectors *must* match the query
embedder for NN search to be meaningful), runs the recall@k harness, parses the
`[evaluation] {...}` line, and prints a side-by-side recall@1/@5/@10 table.
Defaults to a 3,000-card subset (`SUBSET=3000`) for speed; `SUBSET=all
EVAL_CARDS=500` runs the full 20k.

### 4.5 Geometric re-rank as an eval signal

When `rerank_top_k > 0`, `evaluate()` additionally re-orders the embedding
shortlist by ORB keypoints + RANSAC homography inliers
(`pipelines/rerank.py`) and reports `rerank_recall_at_1` / `rerank_recall_at_5`.
Because cards are flat rigid planar objects, a homography fit between the photo
and a candidate reference is a strong same-artwork test, so re-ranking can
recover any true card already present in the embedding's top-K.

---

## 5. Results

All recognition numbers are on **synthetic phone-photo** queries through the
production NN query path. Source of record: the **[Model Card](MODEL_CARD.md)**;
the tracked DVC metric is `ml/metrics.json`.

### 5.1 Embedder comparison (3,000-card index subset)

| System | recall@1 |
|---|---|
| Classical colour/gradient descriptor | 0.247 |
| DINOv2-small (frozen, zero-shot) | 0.750 |
| DINOv2 + learned head | 0.975 |
| DINOv2 + learned head + geometric re-rank | 0.998 |

Geometric re-rank also lifts the zero-shot DINOv2 baseline to recall@1 ≈ 0.917.
This is the sub-project-1 result: a learned embedding massively outperforms the
hand-crafted descriptor, the metric-learning head closes most of the remaining
gap, and geometric verification nearly saturates recall@1.

> The classical descriptor is also the zero-dependency CPU fallback
> (`embedding.py`, `EMBEDDER=classical`), reproducible bit-for-bit in the browser;
> the `ml/metrics.json` checked into the repo is a small classical-embedder run
> (`recall_at_1 = 0.4125` on a 300-card / 200-eval-card configuration) that
> serves as the tracked DVC metric, not the headline DINOv2 result.

### 5.2 Held-out-CARD generalization (cards the head never trained on)

Head trained on the first ~3,000 cards; indexed/evaluated on cards **4000–5500**
(disjoint), via `scripts/eval-heldout.sh`:

| System (cards UNSEEN by the head) | recall@1 | recall@5 | recall@10 |
|---|---|---|---|
| DINOv2-small (frozen, zero-shot) | 0.782 | 0.927 | 0.943 |
| DINOv2 + learned head | **0.973** | 1.000 | 1.000 |
| DINOv2 + learned head + geometric re-rank | **0.990** | 1.000 | — |

The head lifts recall@1 from **0.782 → 0.973** on cards it never saw during
training, and re-rank takes it to **0.990**. This is the key result: the head
learned **photo-invariance**, not memorized identities — it generalizes to unseen
cards.

### 5.3 Assistant groundedness (LLM-as-judge, responsible-AI eval)

The collection assistant must answer **only** from the provided collection
context. `scripts/eval-assistant.sh` runs an LLM-as-judge
(`apps/web/lib/eval/judge.ts`) over hand-written fixtures
(`apps/web/lib/eval/fixtures.ts`, 5 cases): for each case it scores a **grounded**
answer and a **hallucinated** answer on a 1..5 rubric, then asserts grounded
answers outscore hallucinated ones on average (it `exit 1`s otherwise). A
sentinel score of 0 (judge unavailable) is excluded from the averages. Measured
result (local `llama3.2` judge): **grounded avg 5.0 vs hallucinated avg 1.2** —
the "answer only from context" contract is measurable, with no human in the loop.

---

## 6. End-to-end recognition test

`scripts/e2e-recognition-card.sh` validates the *whole stack* on **real card
images** (not synthetic, not a unit mock):

1. Brings up Postgres + runs migrations, builds the trainer and inference images.
2. Builds the pgvector index over the first `N` cards (default 200) using the
   **active recognition config read from `.env`** (`EMBEDDER`, `EMBED_HEAD`), so
   the index matches exactly what the running inference service will use.
3. Starts the inference service and waits for `/health`.
4. Stride-samples `NCHECK` cards (default 5) from the indexed range, reads each
   card's **real reference PNG** straight from the dataset, and POSTs it as a
   `multipart/form-data` upload to the inference service's `/predict` endpoint
   (in-network, `http://inference:8001/predict`).
5. Compares the returned `name.value` (top match) and `name.candidates`
   (shortlist) against the expected card name.

It asserts the correct card is **surfaced in the candidate shortlist for every
injected card** (`hit3 == n`, matching the app's confirm UX) **and** rank-1
accuracy of at least 80 % (`hit1 >= 0.8*n`); otherwise it exits non-zero. Output
ends with `RECOGNITION E2E OK` only on success. The index build writes its metric
to a throwaway `METRICS_PATH=/tmp/...` so the test never clobbers the tracked DVC
metric.

---

## 7. Reproducibility

Every number above is reproducible from a script. From the repo root:

| What | Command |
|---|---|
| Download the full dataset (once) | `bash scripts/download-cards.sh` (or `DOWNLOAD_LIMIT=200 bash scripts/download-cards.sh` for a smoke subset) |
| **§5.1** embedder comparison (3k subset) | `SUBSET=3000 bash scripts/eval-baselines.sh` |
| **§5.1** full-catalogue comparison | `SUBSET=all EVAL_CARDS=500 bash scripts/eval-baselines.sh` |
| **§5.2** held-out-card generalization | `bash scripts/eval-heldout.sh` |
| **§5.2** + geometric re-rank row | `RERANK_TOP_K=10 bash scripts/eval-heldout.sh` |
| **§5.3** assistant groundedness | `bash scripts/eval-assistant.sh` (local Ollama) |
| **§6** end-to-end on real images | `bash scripts/e2e-recognition-card.sh` |
| Train the learned head | `bash scripts/train-head.sh` |
| Reproduce the DVC pipeline / metric | `bash scripts/dvc.sh repro` (see [docs/dvc.md](dvc.md)) |

Reproducibility is built in: the dataset is downloaded once and DVC-tracked; the
synthetic photos are deterministic per `eval_seed`; the eval embeds queries
through the identical production NN path; and the pipeline parameters live in
`params.yaml` / `services/trainer/config.yaml` (overridable by env vars), with
the tracked metric in `ml/metrics.json`.
