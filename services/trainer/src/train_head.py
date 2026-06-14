"""CLI: train the DINOv2 projection head (sub-project 3).

  docker compose run --rm -e EMBEDDER=onnx trainer python train_head.py

Phase 1 (onnx) precomputes DINOv2 features for HEAD_TRAIN_CARDS cards x
HEAD_VIEWS synthetic photos -> $MODEL_DIR/head_features.npz (cached; reused
unless HEAD_RECOMPUTE is set). Phase 2 (torch) trains the InfoNCE head ->
$MODEL_DIR/head.npz.

Apply it afterwards by setting EMBED_HEAD=$MODEL_DIR/head.npz (with
EMBEDDER=onnx) on the trainer and the inference service.

Env: HEAD_TRAIN_CARDS (3000), HEAD_VIEWS (5), HEAD_EPOCHS (40), HEAD_BATCH
(256), HEAD_TEMP (0.05), HEAD_LR (0.001), HEAD_SEED (777), HEAD_RECOMPUTE.
"""
import os

from pipelines.train_head import precompute, train


def main() -> None:
    game = os.environ.get("GAME", "pokemon")
    models = os.environ.get("MODEL_DIR", "/models")
    feats = os.path.join(models, "head_features.npz")
    head = os.path.join(models, "head.npz")

    n_cards = int(os.environ.get("HEAD_TRAIN_CARDS", "3000"))
    n_views = int(os.environ.get("HEAD_VIEWS", "5"))
    seed = int(os.environ.get("HEAD_SEED", "777"))

    # Never apply an existing head while capturing the raw frozen features.
    os.environ.pop("EMBED_HEAD", None)

    if os.environ.get("HEAD_RECOMPUTE") or not os.path.exists(feats):
        print("[head] phase 1: precompute DINOv2 features")
        precompute(game, n_cards, n_views, seed, feats)
    else:
        print(f"[head] phase 1: reusing cached features {feats}")

    # Optional MLflow tracking (best-effort).
    mlflow = None
    try:
        import mlflow as _mlflow

        _mlflow.set_tracking_uri(os.environ.get("MLFLOW_TRACKING_URI", "http://mlflow:5000"))
        _mlflow.set_experiment(f"tcg-{game}-head")
        _mlflow.start_run(run_name="projection-head")
        _mlflow.log_params(
            {
                "head_train_cards": n_cards,
                "head_views": n_views,
                "head_epochs": int(os.environ.get("HEAD_EPOCHS", "40")),
                "head_temp": float(os.environ.get("HEAD_TEMP", "0.05")),
                "head_lr": float(os.environ.get("HEAD_LR", "0.001")),
            }
        )
        mlflow = _mlflow
    except Exception as e:  # noqa: BLE001 - MLflow optional
        print(f"[head] mlflow unavailable; continuing: {e}")

    print("[head] phase 2: train projection head (torch)")
    result = train(
        feats,
        head,
        epochs=int(os.environ.get("HEAD_EPOCHS", "40")),
        batch=int(os.environ.get("HEAD_BATCH", "256")),
        temp=float(os.environ.get("HEAD_TEMP", "0.05")),
        lr=float(os.environ.get("HEAD_LR", "0.001")),
        mlflow=mlflow,
    )
    if mlflow is not None:
        try:
            mlflow.log_metrics({"final_loss": result["final_loss"]})
            mlflow.log_artifact(head)
            mlflow.end_run()
        except Exception:
            pass
    print(f"[head] DONE {result}")


if __name__ == "__main__":
    main()
