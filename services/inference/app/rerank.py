"""Geometric re-ranking — verify which top-K candidate actually matches.

Embedding nearest-neighbor gives a shortlist, but visually-similar cards (same
frame, different art) can out-rank the true card. Cards are flat, rigid, planar
objects, so a homography fit between the query photo and each candidate's
reference image is a strong exact-match test: the true card yields many
RANSAC-consistent ORB feature correspondences; a look-alike yields few.

Re-ranking the shortlist by inlier count lifts recall@1 toward the embedding's
recall@K (it can recover any true card that was already in the top-K). Pure
OpenCV (ORB) — no GPU, no extra model, no network.
"""
from __future__ import annotations

import cv2
import numpy as np
from PIL import Image

_ORB = cv2.ORB_create(nfeatures=600)
_RATIO = 0.75
_MIN_GOOD = 8


def _prep_gray(pil: Image.Image, size: int = 320) -> np.ndarray:
    g = np.asarray(pil.convert("L"))
    h, w = g.shape[:2]
    scale = size / max(h, w)
    if scale < 1.0:
        g = cv2.resize(g, (max(1, int(w * scale)), max(1, int(h * scale))))
    return g


def orb_inliers(query: Image.Image, ref: Image.Image) -> int:
    """RANSAC-homography inlier count between a query photo and a reference."""
    qg, rg = _prep_gray(query), _prep_gray(ref)
    k1, d1 = _ORB.detectAndCompute(qg, None)
    k2, d2 = _ORB.detectAndCompute(rg, None)
    if d1 is None or d2 is None or len(k1) < _MIN_GOOD or len(k2) < _MIN_GOOD:
        return 0
    bf = cv2.BFMatcher(cv2.NORM_HAMMING)
    good = []
    for pair in bf.knnMatch(d1, d2, k=2):
        if len(pair) < 2:
            continue
        m, n = pair
        if m.distance < _RATIO * n.distance:
            good.append(m)
    if len(good) < _MIN_GOOD:
        return len(good)
    src = np.float32([k1[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([k2[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    _, mask = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
    if mask is None:
        return len(good)
    return int(mask.sum())


def rerank(
    query: Image.Image,
    candidates: list[tuple[str, Image.Image]],
    top_k: int = 10,
) -> list[tuple[str, int]]:
    """Re-order the first `top_k` candidates by geometric inliers (stable on
    ties via original rank), keeping the remainder in their original order.

    `candidates` is an ordered list of (id, reference_image). Returns a list of
    (id, inlier_score); ids beyond top_k get score -1 (not verified).
    """
    head = candidates[:top_k]
    tail = candidates[top_k:]
    scored = [
        (orb_inliers(query, ref), -i, cid) for i, (cid, ref) in enumerate(head)
    ]
    scored.sort(reverse=True)
    out: list[tuple[str, int]] = [(cid, inl) for inl, _, cid in scored]
    out.extend((cid, -1) for cid, _ in tail)
    return out
