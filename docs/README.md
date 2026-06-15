# Documentation

Technical documentation for the **TCG Card Recognizer**, written for the teacher
validating this Erasmus AI / MLOps project. Each document explains **what** was
built and **why** the technologies and approaches were chosen, grounded in the
actual implementation (every claim cites real file paths).

> Provenance note: this project was built with an AI coding agent under the
> owner's direction — see **[../AI_DISCLOSURE.md](../AI_DISCLOSURE.md)**.

## Suggested reading order

1. **[architecture.md](architecture.md)** — system overview, services, how they
   connect, and the end-to-end data flow for a card scan (with diagrams).
2. **[technology-choices.md](technology-choices.md)** — the centerpiece: every
   major technology with *what it is, where we use it, why we chose it, and the
   alternatives considered*.
3. **[recognition-pipeline.md](recognition-pipeline.md)** — the computer-vision /
   ML recognition cascade stage by stage: deskew → embeddings (classical &
   DINOv2) → learned head → pgvector search → geometric re-rank → VLM/OCR fusion,
   with the measured accuracy progression.
4. **[mlops.md](mlops.md)** — the MLOps practices: config-driven pipeline, MLflow
   tracking, model registry, DVC data/pipeline versioning, drift monitoring, the
   self-improving flywheel, retraining, and CI/CD — mapped to the course modules.
5. **[data-and-evaluation.md](data-and-evaluation.md)** — data sources, the
   dataset, synthetic phone-photo augmentation, the recall@k evaluation
   methodology, the held-out generalization study, and how to reproduce each
   number.
6. **[web-application.md](web-application.md)** — the Next.js web app: stack and
   rationale, pages and flows, API routes, auth/security, and the multi-TCG
   abstraction.
7. **[llm-and-assistant.md](llm-and-assistant.md)** — the LLM features: the
   provider abstraction + router (local Ollama vs Claude), the RAG collection
   assistant, VLM-assisted recognition, and the LLM-as-judge evaluation.
8. **[development-and-operations.md](development-and-operations.md)** — how to
   run, configure, test, and operate the project (quick start, env reference,
   optional subsystems, e2e tests, ML ops, troubleshooting).

## Reference documents

- **[MODEL_CARD.md](MODEL_CARD.md)** — responsible-AI model card (the recognition
  system, intended use, metrics, limitations).
- **[DATA_CARD.md](DATA_CARD.md)** — dataset card (provenance, licensing/IP,
  schema, preprocessing, splits).
- **[dvc.md](dvc.md)** — the DVC data & pipeline versioning guide.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — contributor guide.

## How the docs were produced

These documents were researched and written by AI agents that read the actual
source, then reviewed and assembled by the owner — consistent with the project's
[AI authorship disclosure](../AI_DISCLOSURE.md). They describe the system **as
implemented**; where a feature is opt-in or aspirational (e.g. the browser-side
learned embedder, or the intentionally-inert Sentinel agent), the docs say so.
