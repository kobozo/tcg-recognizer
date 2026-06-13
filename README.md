# TCG Card Recognizer

AI-powered **Pokémon trading-card recognizer**. Upload or photograph a card → a custom CNN +
multi-label classifier predicts its attributes → enriched via the public Pokémon TCG API →
full card profile in the web app.

Around the product: an **admin section** (users, user-count, MLOps model-rebuild view) and
**Sentinel**, an autonomous PR-shepherd agent that keeps contributors' pull requests moving.

> Erasmus AI project (ML / MLOps / Data Science). Built to run locally via Docker Compose,
> mirroring a production setup.

## Status

Built in phases — see [`docs/superpowers/specs/2026-06-13-tcg-recognizer-platform-design.md`](docs/superpowers/specs/2026-06-13-tcg-recognizer-platform-design.md).

- [ ] ① Foundation — monorepo skeleton, Docker Compose, Caddy, CI, branch protection
- [ ] ② Product — auth, scan→result (stubbed model), admin shell, demos scaffold
- [ ] ③ Real ML + MLOps — dataset, trainer, inference, MLOps admin view
- [ ] ④ Sentinel — PR lifecycle, Slack, auto-merge through gates
- [ ] ⑤ Polish — confidence overlay, contributor docs

## Quick start (once Phase ① lands)

```bash
cp .env.example .env   # fill in values
docker compose up      # app at http://192.168.3.177
```

## Layout

```
apps/web          Next.js (UI + auth + admin + API routes)
services/inference FastAPI CNN serving
services/trainer   one-shot model-rebuild job
services/sentinel  PR-shepherd agent
ml/                datasets + model artifacts (git-ignored)
docs/              proposal + design specs
```

## Contributing (non-technical + AI welcome)

Add a page under `apps/web/app/demos/<your-slug>/page.tsx` and register it in
`demos/registry.ts`. Open a PR — CI checks it and **Sentinel** will shepherd it to merge.
