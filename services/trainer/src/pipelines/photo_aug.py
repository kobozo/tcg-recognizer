"""Synthetic "phone-photo" generator.

Turns a clean catalogue card image into a realistic snapshot: perspective warp,
small rotation, glare/lighting gradient, brightness/contrast/colour jitter,
blur and JPEG artifacts. This is the regime the recognizer actually faces, and
it is the SHARED engine for two consumers:

  * evaluation.py — generate held-out photos to measure recall@k honestly
    (the old eval merely rotated the reference image against itself).
  * the learned-head training (sub-project 3) — generate many augmented views
    per card so a metric-learning head becomes invariant to photo conditions.

The card is assumed to fill the frame (the post-deskew regime the embedder sees,
since /predict deskews first), so no background compositing is done here.

Deterministic: the same `seed` always yields the same photo, so evals are
reproducible and runs are comparable.
"""
from __future__ import annotations

import cv2
import numpy as np
from PIL import Image


def make_photo(pil_image: Image.Image, seed: int = 0) -> Image.Image:
    """Return a synthetic phone-photo of a card image (deterministic per seed)."""
    rng = np.random.default_rng(seed)
    rgb = np.asarray(pil_image.convert("RGB"))
    h, w = rgb.shape[:2]
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)

    # 1) Perspective warp — jitter the four corners (a hand-held angle).
    m = 0.08
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    dst = np.float32(
        [
            [rng.uniform(-w * m, w * m), rng.uniform(-h * m, h * m)],
            [w + rng.uniform(-w * m, w * m), rng.uniform(-h * m, h * m)],
            [w + rng.uniform(-w * m, w * m), h + rng.uniform(-h * m, h * m)],
            [rng.uniform(-w * m, w * m), h + rng.uniform(-h * m, h * m)],
        ]
    )
    out = cv2.warpPerspective(
        bgr, cv2.getPerspectiveTransform(src, dst), (w, h),
        borderMode=cv2.BORDER_REPLICATE,
    )

    # 2) Small in-plane rotation.
    ang = rng.uniform(-8, 8)
    rot = cv2.getRotationMatrix2D((w / 2, h / 2), ang, 1.0)
    out = cv2.warpAffine(out, rot, (w, h), borderMode=cv2.BORDER_REPLICATE)

    # 3) Glare — a bright radial spot somewhere on the card.
    cx, cy = rng.uniform(0, w), rng.uniform(0, h)
    yy, xx = np.mgrid[0:h, 0:w]
    dist = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    rad = rng.uniform(0.3, 0.7) * max(h, w)
    glare = (np.clip(1 - dist / rad, 0, 1) ** 2) * rng.uniform(40, 120)
    out = np.clip(out.astype(np.float32) + glare[..., None], 0, 255).astype(np.uint8)

    # 4) Brightness / contrast jitter.
    alpha = rng.uniform(0.8, 1.2)
    beta = rng.uniform(-25, 25)
    out = np.clip(out.astype(np.float32) * alpha + beta, 0, 255).astype(np.uint8)

    # 5) Hue / saturation jitter.
    hsv = cv2.cvtColor(out, cv2.COLOR_BGR2HSV).astype(np.float32)
    hsv[..., 0] = (hsv[..., 0] + rng.uniform(-5, 5)) % 180
    hsv[..., 1] = np.clip(hsv[..., 1] * rng.uniform(0.85, 1.15), 0, 255)
    out = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)

    # 6) Mild blur (most phone shots aren't perfectly sharp).
    if rng.random() < 0.7:
        k = int(rng.choice([3, 5]))
        out = cv2.GaussianBlur(out, (k, k), 0)

    # 7) JPEG recompression artifacts.
    quality = int(rng.integers(40, 85))
    ok, enc = cv2.imencode(".jpg", out, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if ok:
        decoded = cv2.imdecode(enc, cv2.IMREAD_COLOR)
        if decoded is not None:
            out = decoded

    return Image.fromarray(cv2.cvtColor(out, cv2.COLOR_BGR2RGB))
