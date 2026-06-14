# Phase ③ — Multi-TCG Card Recognizer: model & architecture approach

**Date:** 2026-06-14
**Status:** Decided (scope + approach); recognizer implementation is Phase ③.

## Scope: Pokémon first, built for many TCGs

**Pokémon is the first collection we support, but the app is built to support many** — Magic:
The Gathering, and others later. Everything is structured around a **game/TCG abstraction** so
adding a collection type is "implement a provider + register it," not a rewrite.

## Game providers (data sources — all free, no key required)

A `GameProvider` interface exposes `listSets()`, `getSet(id)`, `getSetCards(setId)` (and later
`predict`/`enrich`). Each supported TCG implements it:

- **Pokémon** → Pokémon TCG API (`api.pokemontcg.io/v2`), no key needed.
- **Magic: The Gathering** → **Scryfall** (`api.scryfall.com`), no key needed (the proposal
  named Scryfall). `/sets` + `/cards/search?q=set:<code>`.
- **Future** (Yu-Gi-Oh!, One Piece, Lorcana…) → add a provider; the UI lists it automatically.

A central registry maps `gameId → { meta, provider }`; the UI renders a game switcher from it.

## Recognizer: existing model, not from-scratch training

Same decision per game, applied through the provider:

1. **Reference index (MLOps "rebuild"):** pull every card's official image from the game's API,
   encode each with a **pretrained image encoder** (OpenCLIP ViT-B/32, CPU-friendly), store
   vectors + metadata in a per-game index on the `models` volume.
2. **Inference:** encode the uploaded photo with the same encoder → **nearest-neighbour** in the
   selected game's index → top-k candidates (name, set, number, rarity) with similarity as
   confidence; existing enrichment fills the rest.
3. **Why:** no training from scratch; "the model" is a pretrained encoder; new cards/sets/games
   = encode + append; returns exact card identity, which a coarse classifier can't.

### Existing-model survey (why retrieval, not a managed/zoo model)
- **Ximilar Collectibles API** — paid, multi-TCG, turnkey; keep as a **benchmark/fallback**, not
  owned.
- Open HF/GitHub models are partial (card *detection*, *authenticity*, or Pokémon *creature*
  classification) — none is a drop-in exact-card identifier. Retrieval with a pretrained encoder
  generalizes across games for free.

## How it lands in the app

- **Data:** `Scan.game` records which TCG a card belongs to (default `pokemon`).
- **`services/inference`:** stub `/predict` (per-game placeholder now) → encode + NN search later;
  response contract unchanged (`{name,type,set,rarity,card_number}` + `model_version`).
- **`services/trainer`:** becomes the per-game **index builder** ("rebuild" = re-encode a game's
  official cards), writing a versioned index + recall@k metrics + a `ModelVersion` row (admin
  MLOps view).
- **UI:** game switcher; sets and collection are scoped/grouped by game.

## Out of scope (now)
Grading/authenticity; multi-card-per-photo; price prediction beyond each API's indicator;
training a classifier from scratch.
