# Data Card — Pokémon TCG Card Image Dataset

A responsible-AI data card for the dataset that backs the recognizer's index and
the learned head, following the standard data-card structure (Gebru et al.,
"Datasheets for Datasets"). Pairs with the **[Model Card](MODEL_CARD.md)**.

## Dataset summary

- **Content:** the full official Pokémon Trading Card Game catalogue — one
  reference image plus metadata per card.
- **Size:** **~20,359 cards**; **~20,306 reference images on disk** (a small
  number of catalogue entries lack a usable image and are skipped). **~3.2 GB**
  total. (The committed DVC pointer records 20,308 files / 3.33 GB for the
  tracked `pokemon` dir, which includes the manifest alongside the images.)
- **Modality:** RGB card scans (PNG), small/large official renders.
- **Card games:** the schema and pipeline are multi-game (`game` field); the
  populated dataset is Pokémon.

## Source & provenance

- **Source:** the public **Pokémon TCG API** (`https://api.pokemontcg.io/v2`),
  paged in full by `services/trainer/src/pipelines/download.py` (250/page).
- **Collection method:** automated download of every card's image + metadata to a
  local cache; resumable (existing non-empty images skipped), failures tolerated
  per-card, concurrency-bounded. Downloaded **once** and reused offline for every
  training/eval run — no re-hitting the API at train time.
- **Versioning:** DVC-tracked (MLOps maturity level 1). The data lives in a local
  DVC remote outside git; only a small pointer (`ml/datasets/pokemon.dvc`),
  `params.yaml`, `dvc.yaml`, and the metric `ml/metrics.json` are committed. See
  **[docs/dvc.md](dvc.md)**.

## Licensing & intended use (IP note)

- Card **images and names are © The Pokémon Company International / Nintendo /
  Game Freak / Creatures Inc.**; the Pokémon TCG API redistributes them for
  developer use. They are used in this project **solely for card recognition and
  educational coursework** — not for redistribution, resale, or commercial use.
- The dataset is **not** committed to git; it is fetched locally per the API's
  terms. Anyone reproducing this work must download it themselves under those
  terms. Do not republish the image files.

## Schema

One JSON object per line in `<DATASET_DIR>/<game>/manifest.jsonl`:

| Field | Type | Description |
|---|---|---|
| `card_id` | string | Stable API card id (e.g. `base1-4`). |
| `name` | string | Card name (e.g. `Charizard`). |
| `set_name` | string | Set/expansion name (e.g. `Base`). |
| `number` | string | Collector number within the set. |
| `rarity` | string | Rarity (e.g. `Rare Holo`), may be empty. |
| `type` | string | Primary type (e.g. `Fire`), may be empty. |
| `image_url` | string | Source image URL (small, else large). |
| `image_path` | string | Repo-relative path to the cached PNG. |

Only manifest rows whose image is present and non-empty on disk are used at
ingest time (`_ingest_from_manifest`).

## Preprocessing

- **Reference embedding:** each card's reference PNG is converted to RGB and
  embedded once (frozen DINOv2-small → 512-d, optionally passed through the
  learned head) to build the pgvector index.
- **Deskew:** the scan path deskews/normalizes the photographed card before
  embedding so query and reference are comparably framed.
- **Synthetic phone-photos (`photo_aug.make_photo`):** for both head training and
  the eval harness we generate held-out augmented views — perspective warp,
  glare, blur, colour shift, and JPEG compression — to approximate real capture
  conditions. These are generated on the fly (seeded for reproducibility), not
  stored.

## Splits

The dataset is an indexed **catalogue**, so "splits" are defined by *which cards
and which photos* each stage touches:

- **Index (reference) set:** card reference images embedded into `card_vectors`.
  Capped/offset via `SAMPLE_SIZE` / `SAMPLE_OFFSET`, or `all` for the full
  catalogue.
- **Learned-head training set:** a stride sample of the **first ~3,000** manifest
  cards × N synthetic views. The DINOv2 backbone is frozen (used as released).
- **Evaluation queries:** **held-out synthetic photos** (never the reference
  image), seeded for reproducibility, of stride-sampled indexed cards.
- **Held-out-CARD split (generalization):** `scripts/eval-heldout.sh` uses
  `SAMPLE_OFFSET` to index/eval a card range **disjoint** from the head's
  training cards — cards the head never saw — to measure generalization rather
  than fit. Keep `HEAD_TRAIN_CARDS < SAMPLE_OFFSET`.

## Limitations & considerations

- **Coverage/recency:** reflects the API at download time; new sets require a
  re-download to appear. Some catalogue entries lack a usable image and are
  dropped.
- **Class imbalance / look-alikes:** many near-identical artworks (reprints,
  evolution stages, alternate printings) — the dominant recognition-error source.
- **Domain gap:** images are clean official renders; real user photos differ.
  Synthetic augmentation narrows but does not close this gap (see the Model
  Card's synthetic-eval caveat).
- **No personal data:** the dataset contains only published card artwork and
  metadata — no PII.
