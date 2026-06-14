"""Sub-project 3 — train a projection head (the actual "pre-training").

Frozen DINOv2 gives a strong generic embedding, but it isn't tuned to be
invariant to *phone-photo* conditions. We learn a small MLP head that pulls a
card's augmented views toward its clean reference and pushes different cards
apart (metric learning, InfoNCE with in-batch negatives). The DINOv2 backbone
stays frozen — only the tiny head trains, so this runs on CPU.

Two phases, deliberately separated so onnxruntime and torch are never both
resident (RAM is tight on this box):

  precompute(): DINOv2-embed each training card's reference + V synthetic
                photos (photo_aug) -> features.npz. Uses onnxruntime only.
  train():      load features.npz, train the head with torch, save head.npz
                (W1,b1,W2,b2) — applied later in pure numpy by embedding.py.
"""
from __future__ import annotations

import os

import numpy as np

from embedding import embed
from pipelines.ingestion import _dataset_paths, _ingest_from_manifest, load_image
from pipelines.photo_aug import make_photo


def _sample_cards(game: str, n: int) -> list[dict]:
    if n <= 0:
        raise ValueError(f"HEAD_TRAIN_CARDS must be > 0 (got {n})")
    _, manifest = _dataset_paths(game)
    items = _ingest_from_manifest(game, manifest, None)
    if not items:
        raise RuntimeError("no manifest cards; download the dataset first")
    if len(items) <= n:
        return items
    step = len(items) / n
    return [items[int(i * step)] for i in range(n)]


def precompute(game: str, n_cards: int, n_views: int, seed: int, out_path: str) -> None:
    """DINOv2-embed references + synthetic views for a sample of cards.

    Relies on embed() using the onnx backend WITHOUT a head (do not set
    EMBED_HEAD when running this), so we capture the raw frozen features.
    """
    if n_views <= 0:
        raise ValueError(f"HEAD_VIEWS must be > 0 (got {n_views})")
    cards = _sample_cards(game, n_cards)
    refs: list[np.ndarray] = []
    augs: list[np.ndarray] = []
    for i, it in enumerate(cards):
        try:
            base = load_image(it)
        except Exception as e:  # noqa: BLE001 - skip unreadable
            print(f"[head] skip {it['card_id']}: {e}")
            continue
        refs.append(np.asarray(embed(base), dtype=np.float32))
        views = [
            np.asarray(embed(make_photo(base, seed=seed + i * 100 + v)), dtype=np.float32)
            for v in range(n_views)
        ]
        augs.append(np.stack(views))
        if (i + 1) % 200 == 0:
            print(f"[head] precompute {i + 1}/{len(cards)}")
    if not refs:
        raise RuntimeError("no readable card images; nothing to precompute")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    np.savez(out_path, ref=np.stack(refs), aug=np.stack(augs))
    print(f"[head] saved features {out_path}: refs={len(refs)} views={n_views}")


def train(
    features_path: str,
    out_head: str,
    epochs: int,
    batch: int,
    temp: float,
    lr: float,
    mlflow=None,
) -> dict:
    """Train the InfoNCE head with torch; save numpy weights to out_head."""
    import torch
    import torch.nn as nn
    import torch.nn.functional as F

    torch.manual_seed(0)
    d = np.load(features_path)
    ref = torch.tensor(d["ref"], dtype=torch.float32)   # [N, D]
    aug = torch.tensor(d["aug"], dtype=torch.float32)   # [N, V, D]
    n, v, dim = aug.shape
    print(f"[head] train: N={n} V={v} D={dim} epochs={epochs} batch={batch}")

    class Head(nn.Module):
        def __init__(self, dim: int):
            super().__init__()
            self.net = nn.Sequential(nn.Linear(dim, dim), nn.ReLU(), nn.Linear(dim, dim))

        def forward(self, x):
            y = self.net(x)
            return y / (y.norm(dim=-1, keepdim=True) + 1e-8)

    head = Head(dim)
    opt = torch.optim.Adam(head.parameters(), lr=lr)

    last = 0.0
    for ep in range(epochs):
        perm = torch.randperm(n)
        tot = 0.0
        nb = 0
        for s0 in range(0, n, batch):
            idx = perm[s0 : s0 + batch]
            if len(idx) < 2:
                continue
            vsel = torch.randint(0, v, (len(idx),))
            a = head(aug[idx, vsel])         # anchor: a random augmented view
            p = head(ref[idx])               # positive: the clean reference
            logits = a @ p.t() / temp        # in-batch negatives
            labels = torch.arange(len(idx))
            loss = (F.cross_entropy(logits, labels) + F.cross_entropy(logits.t(), labels)) / 2
            opt.zero_grad()
            loss.backward()
            opt.step()
            tot += float(loss.item())
            nb += 1
        last = tot / max(1, nb)
        print(f"[head] epoch {ep + 1}/{epochs} loss {last:.4f}")
        if mlflow is not None:
            try:
                mlflow.log_metric("head_loss", last, step=ep)
            except Exception:
                pass

    lins = [m for m in head.net if isinstance(m, nn.Linear)]
    W1 = lins[0].weight.detach().numpy().T.astype(np.float32)  # apply as x@W1+b1
    b1 = lins[0].bias.detach().numpy().astype(np.float32)
    W2 = lins[1].weight.detach().numpy().T.astype(np.float32)
    b2 = lins[1].bias.detach().numpy().astype(np.float32)
    os.makedirs(os.path.dirname(out_head), exist_ok=True)
    np.savez(out_head, W1=W1, b1=b1, W2=W2, b2=b2)
    print(f"[head] saved head {out_head} (final loss {last:.4f})")
    return {"final_loss": round(last, 4), "epochs": epochs, "n": n, "views": v}
