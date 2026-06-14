# Coursework Alignment — applying what we learned at school

**Date:** 2026-06-14
**Source:** the Erasmus course folders in `/home/yannick/Erasmus` (siblings of this project).
**Purpose:** make sure this project demonstrably applies the techniques taught in each course.

## Summary of what each course taught (as found on disk)

| Course | Materials found | Core content |
|---|---|---|
| **Machine Learning Ops** | Full instructor repo + the owner's fork (`instructor_repo_reference`, `kobozo_fork*`, `video_project`) | **DVC** (data versioning), **MLflow** (experiment tracking + model registry), **FastAPI** serving, **YAML-config modular pipeline** (ingestion→cleaning→training→evaluation), Docker, Terraform IaC, **two GitHub Actions workflows** (infra vs app), model promotion via registry, image tagged by date+SHA |
| **AI Fundamentals** | Theory + Exercises | **YOLOv8** custom object detection (train→live inference→export), MediaPipe, OpenCV real-time video, LLM API integration, YAML-driven thresholds |
| **Internet of Things & Big Data** | A complete streaming project | **MQTT** pub/sub, **rolling-window event detection** + debounce/cooldowns, **two-tier storage** (CSV metrics + SQLite events), config-driven thresholds, pandas/matplotlib analytics, documented scale path (Kafka→InfluxDB/ClickHouse→Grafana) |
| **Machine Learning** | Folders present but **files are 0-byte/empty** | No extractable content; our approach already reflects standard practice (transfer learning, train/val/test, F1/top-k, no leakage) |
| **Data Science** | Folders present but **empty** | No extractable content; EDA/metrics practices covered via the IoT analytics patterns |

## How the project already applies it

- **Transfer learning, no training from scratch, held-out real-photo test set, per-label F1/top-k** — Phase ③ recognizer design (`2026-06-14-phase3-...md`). ✓ (ML best practice)
- **FastAPI serving, Docker Compose, GitHub Actions CI, model-version metadata + admin MLOps view, env-driven config** — already built. ✓ (partial MLOps)
- **Config-driven feature flags** (`ENABLED_GAMES`, `PREFERRED_CURRENCY`). ✓

## Gaps to close (prioritized) — "apply what we learned"

1. **[MLOps · HIGH] Use the taught stack in our pipeline.** Adopt **MLflow** (experiment tracking + model registry) and a **YAML-config modular pipeline** (ingestion→training→evaluation) in `services/trainer`; surface MLflow runs in the admin MLOps view. → *This PR.*
2. **[MLOps · MED] DVC for dataset versioning** of the card-image dataset, with `dvc pull` in the training CI. → Phase ③ (when the real dataset/encoder lands).
3. **[MLOps · MED] Two CI workflows** split (infra/compose vs app/train+build) mirroring the instructor repo. → follow-up.
4. **[IoT · MED] Event-driven scan ingestion + rolling-window metrics**: emit scan events (MQTT or an events table), debounced; aggregate per-hour metrics for the admin dashboard (two-tier storage idea). → follow-up.
5. **[AI Fundamentals · MED] YOLOv8 card detection/crop** step before recognition (isolate the card in the photo → better accuracy). → Phase ③ refinement.
6. **[IoT · LOW] Documented scale path** (when to move metrics to a time-series DB). → docs.

## This PR delivers gap #1

- **MLflow tracking server** added to Docker Compose (sqlite backend + artifacts volume).
- **`services/trainer`** rebuilt as a config-driven, modular pipeline (`config.yaml` + `pipelines/`),
  logging params/metrics to MLflow and registering a **model version** (writes a `ModelVersion`
  row in Postgres) — the exact MLflow + config + modular-pipeline pattern from the course.
- **Admin MLOps view** links to the MLflow UI and shows the tracked metrics/version.
- The current pipeline trains a lightweight **baseline** (real ML model swap is Phase ③); the
  MLOps loop around it is what the course graded.
