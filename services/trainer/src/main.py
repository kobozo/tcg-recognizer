"""Orchestrator — config -> ingest -> train -> evaluate -> MLflow + model registry.

This is the MLOps-course pattern applied to our project: a YAML-driven modular
pipeline that logs params/metrics to MLflow and registers a versioned model
(here: a Postgres `ModelVersion` row the admin MLOps view reads).
"""
import json
import os
import uuid

import yaml
import mlflow

from pipelines.ingestion import ingest
from pipelines.training import build_index
from pipelines.evaluation import evaluate

CONFIG = os.path.join(os.path.dirname(__file__), "..", "config.yaml")
MODELS_DIR = os.environ.get("MODEL_DIR", "/models")


def load_cfg() -> dict:
    with open(CONFIG) as f:
        return yaml.safe_load(f)


def register_model_version(version: str, metrics: dict, size: int, run_id: str) -> None:
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("[registry] no DATABASE_URL; skipping ModelVersion write")
        return
    import psycopg2  # imported here so the rest runs even without the driver

    payload = {**metrics, "mlflow_run_id": run_id}
    conn = psycopg2.connect(dsn)
    try:
        with conn, conn.cursor() as cur:
            cur.execute('UPDATE "ModelVersion" SET "isCurrent" = false')
            cur.execute(
                'INSERT INTO "ModelVersion" '
                '(id, version, metrics, "datasetSize", "isCurrent", "trainedAt") '
                "VALUES (%s, %s, %s, %s, true, now())",
                (f"mv_{uuid.uuid4().hex}", version, json.dumps(payload), size),
            )
    finally:
        conn.close()
    print(f"[registry] promoted {version} (isCurrent=true)")


def main() -> None:
    cfg = load_cfg()
    version = f"{cfg['model']['type']}-{uuid.uuid4().hex[:8]}"

    mlflow.set_tracking_uri(os.environ.get("MLFLOW_TRACKING_URI", "http://mlflow:5000"))
    mlflow.set_experiment(f"tcg-{cfg['game']}")

    with mlflow.start_run(run_name=version) as run:
        mlflow.log_params(
            {
                "game": cfg["game"],
                "model": cfg["model"]["type"],
                "hash_size": cfg["model"]["hash_size"],
                "sample_size": cfg["sample_size"],
            }
        )
        items = ingest(cfg)
        index = build_index(items, cfg)
        metrics = evaluate(items, index, cfg)
        mlflow.log_metrics({k: float(v) for k, v in metrics.items()})

        os.makedirs(MODELS_DIR, exist_ok=True)
        artifact = os.path.join(MODELS_DIR, f"{version}.json")
        with open(artifact, "w") as f:
            json.dump({"version": version, "game": cfg["game"], "index": index, "metrics": metrics}, f)
        try:
            mlflow.log_artifact(artifact)
        except Exception as e:  # noqa: BLE001 - artifact proxy is best-effort
            print(f"[mlflow] artifact upload skipped: {e}")

        register_model_version(version, metrics, len(items), run.info.run_id)

    print(f"[done] {version} {metrics}")


if __name__ == "__main__":
    main()
