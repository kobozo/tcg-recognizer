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
# DVC-readable metrics sink (sub-project 4). The trainer service mounts the host
# `./ml` dir at /mlout (read-write), so writing here lands a host-visible
# `ml/metrics.json` that `dvc.yaml`'s train stage declares as a metric. The path
# is env-overridable and default-safe: we only write when its parent dir exists,
# so a plain `docker compose run trainer` (no /mlout mount) never crashes.
METRICS_PATH = os.environ.get("METRICS_PATH", "/mlout/metrics.json")

# Name reported for the active embedder, derived from EMBEDDER so MLflow runs
# and ModelVersion rows are labelled by which backend produced them.
def embed_model_name() -> str:
    backend = os.environ.get("EMBEDDER", "classical").strip().lower()
    return "dinov2-small-512" if backend == "onnx" else "classical-color-grad-512"


EMBED_MODEL_NAME = embed_model_name()


def load_cfg() -> dict:
    with open(CONFIG) as f:
        cfg = yaml.safe_load(f)
    # Env overrides for quick baseline sweeps (SAMPLE_SIZE, EVAL_CARDS, ...).
    # SAMPLE_OFFSET (default 0) skips the first N manifest cards before taking
    # SAMPLE_SIZE, enabling a held-out-card eval over a range disjoint from the
    # head's training set (scripts/eval-heldout.sh). Default 0 == unchanged.
    for key in (
        "game", "sample_size", "sample_offset", "eval_cards", "eval_views",
        "eval_seed", "embed_dim", "rerank_top_k",
    ):
        env = os.environ.get(key.upper())
        if env is not None and env != "":
            cfg[key] = env if key == "sample_size" and env == "all" else (
                int(env) if env.lstrip("-").isdigit() else env
            )
    return cfg


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


def _vec_literal(vec) -> str:
    return "[" + ",".join(repr(float(x)) for x in vec) + "]"


def incorporate_feedback(game: str) -> int:
    """Active learning: add user-confirmed scan embeddings to the index.

    Each confirmed/corrected scan gives a (real-photo embedding -> card name)
    label. We insert those vectors as extra reference points in card_vectors so
    future similar photos match the confirmed card. All in-DB; no image access
    needed (the scan's embedding is persisted in its predictions JSON).
    """
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        return 0
    try:
        import psycopg2
    except Exception:
        return 0
    added = 0
    conn = None
    try:
        conn = psycopg2.connect(dsn)
        with conn, conn.cursor() as cur:
            cur.execute("SELECT to_regclass('public.\"Feedback\"')")
            if cur.fetchone()[0] is None:
                return 0
            cur.execute(
                'SELECT f.id, f."correctedName", s.predictions->\'embedding\' '
                'FROM "Feedback" f JOIN "Scan" s ON s.id = f."scanId" '
                "WHERE f.game = %s AND f.\"correctedName\" <> '' "
                "AND (s.predictions ? 'embedding')",
                (game,),
            )
            for fid, name, emb in cur.fetchall():
                if isinstance(emb, str):
                    emb = json.loads(emb)
                if not isinstance(emb, (list, tuple)) or len(emb) == 0:
                    continue
                cur.execute(
                    "INSERT INTO card_vectors "
                    "(id, game, card_id, name, set_name, number, rarity, type, image_url, embedding) "
                    "VALUES (%s,%s,%s,%s,'','','','','', %s::vector) "
                    "ON CONFLICT (id) DO UPDATE SET embedding=EXCLUDED.embedding, name=EXCLUDED.name",
                    (f"fb:{fid}", game, f"fb:{fid}", name, _vec_literal(emb)),
                )
                added += 1
    except Exception as e:  # noqa: BLE001 - active learning is best-effort
        print(f"[feedback] incorporation skipped: {e}")
    finally:
        if conn is not None:
            conn.close()
    print(f"[feedback] incorporated {added} confirmed labels into the index")
    return added


def write_metrics_file(metrics: dict, version: str, count: int, cfg: dict) -> None:
    """Write the eval metrics to a DVC-readable JSON (sub-project 4).

    Default-safe: writes only when the target directory exists (i.e. the /mlout
    mount is present). A standalone `python main.py` or a trainer run without the
    mount silently skips it — DVC integration is opt-in and must never break the
    core pipeline or CI.
    """
    path = METRICS_PATH
    try:
        parent = os.path.dirname(path) or "."
        if not os.path.isdir(parent):
            print(f"[metrics] {parent} absent; skipping DVC metrics write")
            return
        payload = {
            "version": version,
            "game": cfg.get("game"),
            "embed_model": EMBED_MODEL_NAME,
            "dataset_size": count,
            **{k: float(v) for k, v in metrics.items()},
        }
        with open(path, "w") as f:
            json.dump(payload, f, indent=2)
        print(f"[metrics] wrote DVC metrics to {path}")
    except Exception as e:  # noqa: BLE001 - metrics sink is best-effort
        print(f"[metrics] skipped: {e}")


def main() -> None:
    cfg = load_cfg()
    backend = os.environ.get("EMBEDDER", "classical").strip().lower()
    version = f"{backend}-{uuid.uuid4().hex[:8]}"

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
    fb_added = incorporate_feedback(cfg["game"])
    metrics = evaluate(items, count, cfg)
    metrics["feedback_incorporated"] = fb_added

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

    # DVC-readable metrics (sub-project 4) — host-visible via the /mlout mount.
    write_metrics_file(metrics, version, count, cfg)

    register_model_version(version, metrics, count, run_id)

    if run_ctx is not None:
        try:
            run_ctx.__exit__(None, None, None)
        except Exception as e:  # noqa: BLE001
            print(f"[mlflow] end_run skipped: {e}")

    print(f"[done] {version} {metrics}")


if __name__ == "__main__":
    main()
