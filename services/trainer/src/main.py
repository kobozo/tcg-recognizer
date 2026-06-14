"""Orchestrator — config -> ingest -> build_index -> evaluate -> MLflow + registry.

The MLOps-course pattern applied to our project: a YAML-driven modular pipeline
that logs params/metrics to MLflow and registers a versioned model (a Postgres
`ModelVersion` row the admin MLOps view reads).

MLflow is treated as OPTIONAL: every MLflow call is wrapped in try/except so the
pgvector index build and the ModelVersion write still succeed when no MLflow
server is reachable.
"""
import json
import os
import uuid

import yaml

from pipelines.ingestion import ingest
from pipelines.training import build_index
from pipelines.evaluation import evaluate

CONFIG = os.path.join(os.path.dirname(__file__), "..", "config.yaml")
MODELS_DIR = os.environ.get("MODEL_DIR", "/models")

# Name reported for the classical descriptor; swap for "dinov2"/"siglip" later.
EMBED_MODEL_NAME = "classical-color-grad-512"


def load_cfg() -> dict:
    with open(CONFIG) as f:
        return yaml.safe_load(f)


def register_model_version(version: str, metrics: dict, size: int, run_id) -> None:
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("[registry] no DATABASE_URL; skipping ModelVersion write")
        return
    import psycopg2  # imported here so the rest runs even without the driver

    payload = {**metrics, "mlflow_run_id": run_id}
    conn = psycopg2.connect(dsn)
    try:
        with conn, conn.cursor() as cur:
            # The web app owns the "ModelVersion" table. If it does not exist
            # yet (e.g. standalone trainer run), skip gracefully.
            cur.execute("SELECT to_regclass('public.\"ModelVersion\"')")
            if cur.fetchone()[0] is None:
                print('[registry] "ModelVersion" table absent; skipping write')
                return
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
    version = f"embed-v1-{uuid.uuid4().hex[:8]}"

    # --- MLflow setup (optional) ---
    mlflow = None
    run_ctx = None
    run_id = None
    try:
        import mlflow as _mlflow

        _mlflow.set_tracking_uri(
            os.environ.get("MLFLOW_TRACKING_URI", "http://mlflow:5000")
        )
        _mlflow.set_experiment(f"tcg-{cfg['game']}")
        run_ctx = _mlflow.start_run(run_name=version)
        run_ctx.__enter__()
        run_id = run_ctx.info.run_id if hasattr(run_ctx, "info") else None
        try:
            run_id = _mlflow.active_run().info.run_id
        except Exception:
            pass
        mlflow = _mlflow
    except Exception as e:  # noqa: BLE001 - MLflow is best-effort
        print(f"[mlflow] tracking unavailable; continuing without it: {e}")
        mlflow = None
        run_ctx = None

    if mlflow is not None:
        try:
            mlflow.log_params(
                {
                    "game": cfg["game"],
                    "embed_model": EMBED_MODEL_NAME,
                    "sample_size": cfg["sample_size"],
                }
            )
        except Exception as e:  # noqa: BLE001
            print(f"[mlflow] log_params skipped: {e}")

    # --- Core pipeline (must succeed regardless of MLflow) ---
    items = ingest(cfg)
    count = build_index(items, cfg)
    metrics = evaluate(items, count, cfg)

    if mlflow is not None:
        try:
            mlflow.log_metrics({k: float(v) for k, v in metrics.items()})
        except Exception as e:  # noqa: BLE001
            print(f"[mlflow] log_metrics skipped: {e}")

    # Optional model artifact JSON.
    try:
        os.makedirs(MODELS_DIR, exist_ok=True)
        artifact = os.path.join(MODELS_DIR, f"{version}.json")
        with open(artifact, "w") as f:
            json.dump(
                {
                    "version": version,
                    "game": cfg["game"],
                    "embed_model": EMBED_MODEL_NAME,
                    "dataset_size": count,
                    "metrics": metrics,
                },
                f,
            )
        if mlflow is not None:
            try:
                mlflow.log_artifact(artifact)
            except Exception as e:  # noqa: BLE001
                print(f"[mlflow] artifact upload skipped: {e}")
    except Exception as e:  # noqa: BLE001 - artifact is optional
        print(f"[artifact] skipped: {e}")

    register_model_version(version, metrics, count, run_id)

    if run_ctx is not None:
        try:
            run_ctx.__exit__(None, None, None)
        except Exception as e:  # noqa: BLE001
            print(f"[mlflow] end_run skipped: {e}")

    print(f"[done] {version} {metrics}")


if __name__ == "__main__":
    main()
