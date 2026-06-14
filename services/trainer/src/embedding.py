"""Shared visual-embedding module (CPU-only, classical descriptor).

NOTE: This is a *classical* hand-crafted visual descriptor (color histograms +
gradient-orientation histogram + a downsampled pixel block), NOT a learned
embedding. It is deterministic and dependency-light (OpenCV / Pillow / numpy)
so it runs comfortably on CPU. It is intentionally swappable: replacing `embed`
with a DINOv2 / SigLIP forward pass (returning a 512-d L2-normalized vector)
would drop straight into the rest of the pipeline unchanged.

This file is duplicated byte-for-byte in services/inference and services/trainer
because the two services are separate Docker build contexts and must agree on
the embedding so that pgvector nearest-neighbor search is meaningful.

PORTABILITY NOTE: `embed()` is implemented so it can be reproduced bit-for-bit
in a browser (see apps/web/lib/clientEmbedding.ts). To that end, every resize
inside `embed()` uses an explicit NEAREST-NEIGHBOR resample (plain numpy, no
PIL bilinear) with index math `src = floor(dst * src_size / dst_size)`, which is
trivially portable to JS. `deskew()` is NOT portable (OpenCV) and is unchanged.
"""
from __future__ import annotations

import numpy as np
from PIL import Image
import cv2

EMBED_DIM = 512

# Target card geometry for the deskew warp (~2.5 x 3.5 aspect, portrait).
_CARD_W = 360
_CARD_H = 504


def _to_bgr(image) -> np.ndarray:
    """Accept a PIL.Image or a numpy BGR array; return a numpy BGR (uint8) array."""
    if isinstance(image, Image.Image):
        rgb = np.asarray(image.convert("RGB"))
        return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    arr = np.asarray(image)
    if arr.ndim == 2:
        return cv2.cvtColor(arr, cv2.COLOR_GRAY2BGR)
    return arr


def _to_pil(bgr: np.ndarray) -> Image.Image:
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    return Image.fromarray(rgb)


def _resize_nearest(arr: np.ndarray, dst_h: int, dst_w: int) -> np.ndarray:
    """Nearest-neighbor resample, JS-portable. Works for 2-D or 3-D arrays.

    For output pixel (oy, ox): src_y = floor(oy * src_h / dst_h),
    src_x = floor(ox * src_w / dst_w). This deliberately mirrors the exact
    index math used by the TypeScript port so the two stay bit-compatible.
    """
    src_h, src_w = arr.shape[0], arr.shape[1]
    ys = (np.arange(dst_h) * src_h // dst_h).astype(np.intp)
    xs = (np.arange(dst_w) * src_w // dst_w).astype(np.intp)
    return arr[ys[:, None], xs[None, :]]


def _order_quad(pts: np.ndarray) -> np.ndarray:
    """Order 4 points as top-left, top-right, bottom-right, bottom-left."""
    pts = pts.reshape(4, 2).astype("float32")
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).reshape(-1)
    rect[0] = pts[np.argmin(s)]  # top-left  (smallest x+y)
    rect[2] = pts[np.argmax(s)]  # bottom-right (largest x+y)
    rect[1] = pts[np.argmin(d)]  # top-right (smallest y-x)
    rect[3] = pts[np.argmax(d)]  # bottom-left (largest y-x)
    return rect


def deskew(image) -> Image.Image:
    """Detect the card quad and perspective-warp it to a portrait rectangle.

    OpenCV pipeline: grayscale -> blur -> Canny -> findContours -> pick the
    largest ~4-point convex quad by area -> warp. If no good quad is found,
    return the original image unchanged. Never raises.
    """
    try:
        bgr = _to_bgr(image)
        if bgr is None or bgr.size == 0:
            return image if isinstance(image, Image.Image) else _to_pil(_to_bgr(image))

        h, w = bgr.shape[:2]
        img_area = float(h * w)

        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        edges = cv2.Canny(blurred, 50, 150)
        # Dilate slightly to close gaps so the card outline forms a contour.
        edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)

        contours, _ = cv2.findContours(
            edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )

        best_quad = None
        best_area = 0.0
        for c in contours:
            area = cv2.contourArea(c)
            # Ignore tiny specks and full-frame borders.
            if area < 0.05 * img_area:
                continue
            peri = cv2.arcLength(c, True)
            approx = cv2.approxPolyDP(c, 0.02 * peri, True)
            if len(approx) == 4 and cv2.isContourConvex(approx) and area > best_area:
                best_area = area
                best_quad = approx

        if best_quad is None:
            return _to_pil(bgr)

        rect = _order_quad(best_quad)
        dst = np.array(
            [[0, 0], [_CARD_W - 1, 0], [_CARD_W - 1, _CARD_H - 1], [0, _CARD_H - 1]],
            dtype="float32",
        )
        M = cv2.getPerspectiveTransform(rect, dst)
        warped = cv2.warpPerspective(bgr, M, (_CARD_W, _CARD_H))
        return _to_pil(warped)
    except Exception:
        # Deskew must never raise; degrade gracefully to the input image.
        try:
            return image if isinstance(image, Image.Image) else _to_pil(_to_bgr(image))
        except Exception:
            return Image.new("RGB", (_CARD_W, _CARD_H), (0, 0, 0))


def embed(pil_image) -> list[float]:
    """Deterministic 512-dim L2-normalized classical visual descriptor.

    The descriptor is deliberately *spatial* rather than purely global: TCG
    cards share a near-identical border/frame, so global color/orientation
    histograms alone barely distinguish them. We instead capture WHERE colors
    and structure sit on the card.

    Components (concatenated, then padded/truncated to exactly 512 dims):
      (a) 4x4 spatial grid: per-cell mean RGB (3) + per-cell grayscale std (1)
          -> 16 cells x 4 = 64 features (spatial color/contrast layout)
      (b) mean-subtracted downsampled grayscale pixel block (18x18 = 324)
          -> the art's spatial structure, brightness-invariant
      (c) per-channel global color histograms (3 x 16 bins = 48)
      (d) grayscale gradient-orientation histogram (36 bins, magnitude-weighted)
    Total = 472 features -> zero-padded to 512 -> L2-normalized.
    No randomness. Always returns exactly 512 floats.
    """
    if not isinstance(pil_image, Image.Image):
        pil_image = _to_pil(_to_bgr(pil_image))

    src_rgb = np.asarray(pil_image.convert("RGB"), dtype=np.float32)  # (H,W,3)
    rgb = _resize_nearest(src_rgb, 224, 224)  # (224,224,3) nearest-neighbor
    gray = (0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2])

    feats: list[np.ndarray] = []

    # (a) Spatial grid of per-cell mean RGB + grayscale std.
    cells = 4
    step = 224 // cells
    for gy_i in range(cells):
        for gx_i in range(cells):
            ys, xs = slice(gy_i * step, (gy_i + 1) * step), slice(gx_i * step, (gx_i + 1) * step)
            block = rgb[ys, xs, :]
            feats.append(block.reshape(-1, 3).mean(axis=0) / 255.0)  # 3
            feats.append(np.array([gray[ys, xs].std() / 128.0], dtype=np.float32))  # 1

    # (b) Mean-subtracted downsampled grayscale block (spatial structure).
    small = _resize_nearest(gray.astype(np.uint8), 18, 18).astype(np.float32)
    small = small - float(small.mean())  # focus on structure, not absolute brightness
    feats.append((small / 128.0).ravel())

    # (c) Per-channel global color histograms (16 bins each), area-normalized.
    npx = float(rgb.shape[0] * rgb.shape[1])
    for ch in range(3):
        hist, _ = np.histogram(rgb[:, :, ch], bins=16, range=(0, 255))
        feats.append(hist.astype(np.float32) / npx)

    # (d) Grayscale gradient-orientation histogram (magnitude-weighted, HOG-like).
    gx = np.zeros_like(gray)
    gy = np.zeros_like(gray)
    gx[:, 1:-1] = gray[:, 2:] - gray[:, :-2]
    gy[1:-1, :] = gray[2:, :] - gray[:-2, :]
    mag = np.sqrt(gx * gx + gy * gy)
    ang = (np.arctan2(gy, gx) + np.pi)  # 0..2pi
    nbins = 36
    bin_idx = np.minimum((ang / (2 * np.pi) * nbins).astype(int), nbins - 1)
    ohist = np.zeros(nbins, dtype=np.float32)
    np.add.at(ohist, bin_idx.ravel(), mag.ravel())
    s = float(ohist.sum())
    if s > 0:
        ohist = ohist / s
    feats.append(ohist)

    vec = np.concatenate(feats).astype(np.float32)

    # Project/pad/truncate to EXACTLY 512 dims.
    if vec.shape[0] < EMBED_DIM:
        vec = np.pad(vec, (0, EMBED_DIM - vec.shape[0]))
    else:
        vec = vec[:EMBED_DIM]

    # L2-normalize.
    norm = float(np.linalg.norm(vec))
    if norm > 0:
        vec = vec / norm

    return [float(x) for x in vec.tolist()]
