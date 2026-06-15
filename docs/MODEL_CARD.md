# Model Card — TCG Card Recognizer

A responsible-AI model card for the recognition system in this repo, following
the standard structure (Mitchell et al., 2019). It describes what the model is,
how it was built and evaluated, and where it should and should not be trusted.

## Model details

- **Developed by:** Erasmus AI project (ML / MLOps / Data Science coursework).
- **Task:** Trading-card *recognition* — given a photo of a single Pokémon TCG
  card, return the most likely card identity (and a ranked shortlist) for the
  user to confirm.
- **Type:** A retrieval (nearest-neighbour) recognizer, not a fixed-class
  classifier. New cards are added by indexing their reference embedding — no
  retraining of a softmax head over a closed label set.
- **Pipeline (cascade):**
  1. **Backbone embedder** — DINOv2-small (ViT-S/14), **frozen**, exported to
     ONNX, producing a 512-d image embedding (`EMBEDDER=onnx`). A CPU "classical"
     colour/gradient descriptor (512-d) is the zero-dependency fallback.
  2. **Learned projection head** — a small 2-layer MLP (`dim→dim→dim`, ReLU,
     L2-normalised) trained with InfoNCE/metric-learning to make a card's
     phone-photo views land near its clean reference. Applied in pure NumPy on
     top of the frozen backbone (`EMBED_HEAD=/models/head.npz`). The backbone
     stays frozen — only the tiny head trains, so it runs on CPU.
  3. **Vector search** — pgvector cosine nearest-neighbour over the indexed card
     embeddings (`card_vectors`), returning a top-K shortlist.
  4. **Geometric re-rank** (optional, `RERANK_TOP_K>0`) — re-orders the shortlist
     by ORB keypoints + RANSAC homography inliers, a CV check that the candidate
     and the photo are the same artwork.
  5. **VLM disambiguation** (optional, `VLM_ASSIST=1`) — on uncertain shortlists
     a vision-language model (Claude vision or a local Ollama vision model) reads
     the card's printed text and picks from the shortlist; the pick is
     constrained to candidates and never overrides on its own.
  6. **OCR / text channel** (optional, Postgres + pgvector `card_text_vectors`)
     — a complementary printed-text match for hard cases.
- **Provider routing:** the LLM/VLM channels route through a provider
  abstraction (`apps/web/lib/llm/`) that prefers Claude when keyed, else a local
  Ollama model, with graceful fallback. The optional assistant text model
  defaults to `claude-opus-4-8` (`ASSISTANT_MODEL`).

## Intended use

- **Primary:** Help a hobbyist identify and catalogue cards they own, surfacing a
  shortlist they confirm in the app; power a collection view and a
  natural-language collection assistant.
- **Users:** Individual collectors running the app locally (Docker Compose).
- **Out of scope:** Authentication/grading of cards, counterfeit detection,
  automated price arbitrage, or any high-stakes / financial decision without a
  human confirming the match. The shortlist is a suggestion, not an appraisal.

## Training data

- **Catalogue / index:** the full Pokémon TCG catalogue (~20,359 cards;
  ~20,306 reference images, ~3.2 GB), sourced from `api.pokemontcg.io`,
  DVC-tracked. See the **[Data Card](DATA_CARD.md)** for provenance, licensing,
  schema and preprocessing.
- **Backbone:** DINOv2-small is used **as released** (self-supervised
  pre-training on LVD-142M); we do **not** fine-tune it.
- **Learned head:** trained with metric learning (InfoNCE, in-batch negatives) on
  synthetic phone-photo augmentations (`photo_aug`: perspective, glare, blur,
  colour shift, JPEG) of a **stride sample of the first ~3,000 manifest cards**.
  This sampling choice is exactly what the held-out-card eval below probes.

## Evaluation

- **Harness (honest by construction):** for each evaluated card we generate
  *held-out* synthetic phone-photos (not the reference image), embed them with the
  **same** embedder used to build the index, run the **same** pgvector query the
  inference service uses, and record the rank of the true card → recall@1/@5/@10.
  This replaced an earlier near-circular eval that matched a slightly-rotated
  reference against itself.
- **Headline results** (Pokémon, 3k-card index subset, synthetic-photo eval):

  | System | recall@1 |
  |---|---|
  | Classical colour/gradient descriptor | 0.247 |
  | DINOv2-small (frozen, zero-shot) | 0.750 |
  | DINOv2 + learned head | 0.975 |
  | DINOv2 + learned head + geometric re-rank | 0.998 |

  Geometric re-rank also lifts the zero-shot DINOv2 baseline (recall@1 ≈ 0.917).

- **Held-out-CARD generalization (measured):** the headline numbers above
  index/eval cards that **overlap** the head's training cards (the first ~3k),
  so they measure fit. **`scripts/eval-heldout.sh`** answers the real question:
  via `SAMPLE_OFFSET` it indexes + evaluates a card range **disjoint** from the
  head's training set (the head never saw these cards) and reports recall **with
  vs without** the head. Result (head trained on the first ~3k cards; evaluated
  on cards 4000–5500, synthetic photos):

  | System (cards UNSEEN by the head) | recall@1 | recall@5 | recall@10 |
  |---|---|---|---|
  | DINOv2-small (frozen, zero-shot) | 0.782 | 0.927 | 0.943 |
  | DINOv2 + learned head | **0.973** | 1.000 | 1.000 |
  | DINOv2 + learned head + geometric re-rank | **0.990** | 1.000 | — |

  The head lifts recall@1 from 0.78 → 0.97 on cards it **never trained on**, so it
  **generalizes** — it learned photo-invariance, not memorized identities. (Run
  requires `HEAD_TRAIN_CARDS < SAMPLE_OFFSET`.)

- **Assistant groundedness (responsible-AI eval, measured):** the collection
  assistant must answer **only** from the provided collection context.
  **`scripts/eval-assistant.sh`** runs an LLM-as-judge (`apps/web/lib/eval/judge.ts`)
  that scores answers 1..5 for groundedness over hand-written fixtures and asserts
  grounded answers outscore hallucinated ones — a hallucination check with no human
  in the loop. Result (local `llama3.2` judge, 5 fixtures): **grounded avg 5.0 vs
  hallucinated avg 1.2**.

## Limitations

- **Look-alike cards:** near-identical artwork (e.g. evolution stages, reprints,
  alternate set printings) is the dominant error mode; the re-rank and VLM
  channels exist to break these ties but cannot always.
- **Synthetic-eval optimism:** results are on *synthetic* phone-photos.
  Real-world glare, occlusion, sleeves, wear, and odd backgrounds will be harder;
  treat the headline recall as an upper bound and weight `eval-heldout.sh`.
- **Held-out-card scope:** the head was trained on a ~3k-card sample, but the
  held-out eval shows it still lifts recall@1 to 0.97 on unseen cards (4000–5500),
  so it generalizes well in-distribution. The very long tail of the ~20k catalogue
  and truly novel art styles are still bounded by the frozen backbone; a
  full-catalogue head train is the documented next step for maximum coverage.
- **CPU-bound:** the box is RAM/CPU-tight; the backbone is frozen and the head is
  tiny by design. Local VLM/LLM channels are slow and gated off by default.
- **Single-card assumption:** expects one well-framed card per photo.

## Ethical & responsible-AI considerations

- **Licensing / IP:** card artwork is © Pokémon / The Pokémon Company
  International and Wizards of the Coast; used here for **recognition and
  education**, not redistribution. See the Data Card.
- **Human-in-the-loop:** the app surfaces a shortlist the user **confirms** — the
  model never silently commits an identity, and value/price figures are
  point-in-time snapshots, not appraisals.
- **Privacy & opt-in AI:** the cloud LLM/VLM channels are off by default; a fully
  **local** path (Ollama) keeps photos and collection data on-device. No new
  required secrets; CI never calls a model.
- **Groundedness:** the assistant is prompted to answer only from collection data
  and is continuously checked by the LLM-judge groundedness eval.

## Self-improving feedback flywheel

When a user **confirms or corrects** a scan, the confirmed (real-photo embedding
→ card name) pair is added to the index as an extra reference point
(`incorporate_feedback`), so future similar photos match the confirmed card —
active learning from real usage, in-DB, with no image re-access. Over time this
adapts the index to real-world photo conditions the synthetic augmentations only
approximate.

## How to reproduce

- Baselines (classical vs DINOv2): `scripts/eval-baselines.sh`
- Train + measure the head: `scripts/train-head.sh`
- **Held-out-card generalization:** `scripts/eval-heldout.sh`
- **Assistant groundedness (LLM-judge):** `scripts/eval-assistant.sh`
- End-to-end recognition on real card images: `scripts/e2e-recognition-card.sh`
