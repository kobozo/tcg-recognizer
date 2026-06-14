"""Shared visual-embedding module (CPU-only). Two selectable backends.

`embed(pil) -> list[512 floats]` dispatches on the env var ``EMBEDDER``:

  * ``classical`` (DEFAULT) -- a hand-crafted visual descriptor (color
    histograms + gradient-orientation histogram + a downsampled pixel block).
    It is deterministic and dependency-light (OpenCV / Pillow / numpy) so it
    runs comfortably on CPU. It is reproducible bit-for-bit in a browser.

  * ``onnx`` -- a *learned* embedding from DINOv2-small (``Xenova/dinov2-small``)
    run via onnxruntime on CPU. The CLS token of ``last_hidden_state`` is taken,
    L2-normalized, then padded/truncated to EXACTLY 512 dims and L2-normalized
    again so the existing pgvector ``vector(512)`` table is unchanged. The
    browser uses the SAME model via transformers.js (apps/web/lib/onnxEmbedding.ts)
    so on-device embeddings match the server's index. The ONNX weights and the
    model's ``preprocessor_config.json`` are lazily downloaded once from the
    Hugging Face hub into ``$MODEL_DIR/onnx/dinov2-small/`` and reused. If the
    model cannot be fetched or loaded, ``_embed_onnx`` logs and FALLS BACK to the
    classical descriptor (it never raises), so the service stays available.

The ONNX path is OPT-IN: with ``EMBEDDER`` unset/``classical`` behavior is
exactly as before (no model download, no network).

This file is duplicated byte-for-byte in services/inference and services/trainer
because the two services are separate Docker build contexts and must agree on
the embedding so that pgvector nearest-neighbor search is meaningful.

PORTABILITY NOTE: the CLASSICAL `embed()` (``_embed_classical``) is implemented
so it can be reproduced bit-for-bit in a browser (see
apps/web/lib/clientEmbedding.ts). To that end, every resize inside it uses an
explicit NEAREST-NEIGHBOR resample (plain numpy, no PIL bilinear) with index
math `src = floor(dst * src_size / dst_size)`, which is trivially portable to JS.
`deskew()` is NOT portable (OpenCV) and is unchanged.
"""
from __future__ import annotations

import os
import sys
import threading

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
    """Compute a 512-dim L2-normalized embedding, selecting the backend by env.

    ``EMBEDDER=onnx`` uses the learned DINOv2-small ONNX embedding (with a
    transparent fall-back to the classical descriptor if the model cannot be
    loaded); anything else (the default ``classical``) uses the hand-crafted
    descriptor. Always returns exactly 512 floats.

    When ``EMBED_HEAD`` points at a trained projection head (sub-project 3), it
    is applied on top of the onnx embedding so index + query share the learned,
    augmentation-invariant space.
    """
    if os.environ.get("EMBEDDER", "classical").strip().lower() == "onnx":
        # Apply the head ONLY when onnx genuinely produced the embedding — if
        # the onnx model is unavailable, _embed_onnx() falls back to the
        # classical descriptor, which the DINOv2-trained head must not touch.
        onnx_ok = _ensure_onnx() is not None
        vec = _embed_onnx(pil_image)
        if onnx_ok:
            head = _load_head()
            if head is not None:
                try:
                    return _apply_head(vec, head)
                except Exception as e:  # noqa: BLE001 - never break embed()
                    print(f"[embed:head] apply failed; using base embedding: {e}", file=sys.stderr)
        return vec
    return _embed_classical(pil_image)


# ---------------------------------------------------------------------------
# Learned projection head (sub-project 3): a tiny MLP trained with metric
# learning to pull a card's augmented views toward its reference. Trained with
# torch (train_head.py) but APPLIED here in pure numpy, so the inference path
# needs no torch. Enabled by EMBED_HEAD=<path to head.npz>.
# ---------------------------------------------------------------------------
_HEAD_LOCK = threading.Lock()
_HEAD: tuple | bool | None = None  # weights tuple, or False if disabled/failed


def _load_head():
    global _HEAD
    if _HEAD is not None:
        return _HEAD or None
    with _HEAD_LOCK:
        if _HEAD is not None:
            return _HEAD or None
        path = os.environ.get("EMBED_HEAD", "").strip()
        if not path or not os.path.exists(path):
            _HEAD = False
            return None
        try:
            d = np.load(path)
            W1, b1, W2, b2 = d["W1"], d["b1"], d["W2"], d["b2"]
            # Validate shapes so a malformed head can never crash embed().
            if (
                W1.ndim != 2 or W2.ndim != 2 or b1.ndim != 1 or b2.ndim != 1
                or W1.shape[1] != b1.shape[0]
                or W2.shape[0] != b1.shape[0]
                or W2.shape[1] != b2.shape[0]
            ):
                raise ValueError(
                    f"bad head shapes: W1{W1.shape} b1{b1.shape} W2{W2.shape} b2{b2.shape}"
                )
            _HEAD = (
                W1.astype(np.float32), b1.astype(np.float32),
                W2.astype(np.float32), b2.astype(np.float32),
            )
            print(f"[embed:head] loaded projection head {path}", file=sys.stderr)
        except Exception as e:  # noqa: BLE001 - never break the embed path
            print(f"[embed:head] load failed; ignoring head: {e}", file=sys.stderr)
            _HEAD = False
            return None
    return _HEAD


def _apply_head(vec_list, head) -> list[float]:
    """Forward a 2-layer ReLU MLP in numpy, then L2-normalize and fit to 512."""
    W1, b1, W2, b2 = head
    x = np.asarray(vec_list, dtype=np.float32)
    h = np.maximum(0.0, x @ W1 + b1)
    y = (h @ W2 + b2).astype(np.float32)
    return _fit_512(y)


def _embed_classical(pil_image) -> list[float]:
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


# ---------------------------------------------------------------------------
# Learned backend: DINOv2-small via onnxruntime (EMBEDDER=onnx).
# ---------------------------------------------------------------------------

# Hugging Face repo + the two files we need (model graph + preprocessing config).
_HF_REPO = "Xenova/dinov2-small"
_HF_BASE = f"https://huggingface.co/{_HF_REPO}/resolve/main"
_ONNX_REL = "onnx/model.onnx"
_PREPROC_REL = "preprocessor_config.json"

# Module-level lazy cache so the model + preprocessing are loaded exactly once.
_ONNX_LOCK = threading.Lock()
_ONNX_STATE: dict | None = None  # {"session", "input_name", "preproc"} once ready
_ONNX_FAILED = False  # set True after a load failure so we don't retry every call


def _model_cache_dir() -> str:
    base = os.environ.get("MODEL_DIR", "/models")
    return os.path.join(base, "onnx", "dinov2-small")


def _download_once(url: str, dest: str) -> None:
    """Download ``url`` to ``dest`` if not already present. Raises on failure."""
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return
    import requests  # local import; only needed on the onnx path

    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    with requests.get(url, stream=True, timeout=120) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(chunk_size=1 << 20):
                if chunk:
                    f.write(chunk)
    os.replace(tmp, dest)


def _default_preproc() -> dict:
    """DINOv2 image-processor defaults (used if the config can't be read)."""
    return {
        "size": {"shortest_edge": 256},
        "crop_size": {"height": 224, "width": 224},
        "image_mean": [0.485, 0.456, 0.406],
        "image_std": [0.229, 0.224, 0.225],
        "do_resize": True,
        "do_center_crop": True,
        "rescale_factor": 1 / 255.0,
    }


def _load_preproc(path: str) -> dict:
    import json

    cfg = _default_preproc()
    try:
        with open(path) as f:
            raw = json.load(f)
    except Exception:
        return cfg
    # Merge known keys, tolerating the various shapes HF processors use.
    if isinstance(raw.get("size"), dict):
        cfg["size"] = raw["size"]
    elif isinstance(raw.get("size"), int):
        cfg["size"] = {"shortest_edge": raw["size"]}
    if isinstance(raw.get("crop_size"), dict):
        cfg["crop_size"] = raw["crop_size"]
    elif isinstance(raw.get("crop_size"), int):
        cfg["crop_size"] = {"height": raw["crop_size"], "width": raw["crop_size"]}
    for k in ("image_mean", "image_std", "do_resize", "do_center_crop"):
        if k in raw:
            cfg[k] = raw[k]
    if "rescale_factor" in raw:
        cfg["rescale_factor"] = raw["rescale_factor"]
    return cfg


def _ensure_onnx():
    """Lazily download + load the DINOv2 ONNX model. Returns state or None."""
    global _ONNX_STATE, _ONNX_FAILED
    if _ONNX_STATE is not None:
        return _ONNX_STATE
    if _ONNX_FAILED:
        return None
    with _ONNX_LOCK:
        if _ONNX_STATE is not None:
            return _ONNX_STATE
        if _ONNX_FAILED:
            return None
        try:
            import onnxruntime as ort  # local import; manylinux wheel

            cache = _model_cache_dir()
            model_path = os.path.join(cache, "model.onnx")
            preproc_path = os.path.join(cache, "preprocessor_config.json")
            _download_once(f"{_HF_BASE}/{_ONNX_REL}", model_path)
            try:
                _download_once(f"{_HF_BASE}/{_PREPROC_REL}", preproc_path)
            except Exception as e:  # noqa: BLE001 - preproc has sane defaults
                print(f"[embed:onnx] preprocessor_config download failed; using defaults: {e}", file=sys.stderr)

            so = ort.SessionOptions()
            so.intra_op_num_threads = int(os.environ.get("ORT_THREADS", "0")) or 0
            session = ort.InferenceSession(
                model_path, sess_options=so, providers=["CPUExecutionProvider"]
            )
            preproc = _load_preproc(preproc_path)
            _ONNX_STATE = {
                "session": session,
                "input_name": session.get_inputs()[0].name,
                "preproc": preproc,
            }
            print(f"[embed:onnx] loaded DINOv2-small ONNX from {model_path}", file=sys.stderr)
            return _ONNX_STATE
        except Exception as e:  # noqa: BLE001 - never fail the request path
            _ONNX_FAILED = True
            print(f"[embed:onnx] load failed; falling back to classical: {e}", file=sys.stderr)
            return None


def _preprocess_onnx(pil_image, preproc: dict) -> np.ndarray:
    """Preprocess a PIL image to NCHW float32, matching the DINOv2 processor.

    Resize shortest side to ``size.shortest_edge`` (bicubic) -> center-crop
    ``crop_size`` -> scale to [0,1] -> normalize with image_mean/image_std.
    Mirrors transformers / transformers.js DINOv2 image processing.
    """
    if not isinstance(pil_image, Image.Image):
        pil_image = _to_pil(_to_bgr(pil_image))
    img = pil_image.convert("RGB")

    size = preproc.get("size", {})
    shortest = int(size.get("shortest_edge", size.get("height", 256)))
    crop = preproc.get("crop_size", {})
    crop_h = int(crop.get("height", 224))
    crop_w = int(crop.get("width", 224))

    # Resize shortest edge to `shortest`, preserving aspect ratio (bicubic).
    w, h = img.size
    if w <= h:
        new_w = shortest
        new_h = int(round(h * shortest / w))
    else:
        new_h = shortest
        new_w = int(round(w * shortest / h))
    img = img.resize((new_w, new_h), Image.BICUBIC)

    # Center-crop to (crop_h, crop_w).
    left = max(0, (new_w - crop_w) // 2)
    top = max(0, (new_h - crop_h) // 2)
    img = img.crop((left, top, left + crop_w, top + crop_h))
    # Guard against off-by-one if the source was smaller than the crop.
    if img.size != (crop_w, crop_h):
        img = img.resize((crop_w, crop_h), Image.BICUBIC)

    arr = np.asarray(img, dtype=np.float32)  # (H,W,3), 0..255
    rescale = float(preproc.get("rescale_factor", 1 / 255.0))
    arr = arr * rescale
    mean = np.asarray(preproc.get("image_mean", [0.485, 0.456, 0.406]), dtype=np.float32)
    std = np.asarray(preproc.get("image_std", [0.229, 0.224, 0.225]), dtype=np.float32)
    arr = (arr - mean) / std
    chw = np.transpose(arr, (2, 0, 1))  # (3,H,W)
    return chw[None, ...].astype(np.float32)  # (1,3,H,W)


def _fit_512(vec: np.ndarray) -> list[float]:
    """L2-normalize, pad/truncate to EXACTLY 512, L2-normalize again."""
    n = float(np.linalg.norm(vec))
    if n > 0:
        vec = vec / n
    if vec.shape[0] < EMBED_DIM:
        vec = np.pad(vec, (0, EMBED_DIM - vec.shape[0]))
    else:
        vec = vec[:EMBED_DIM]
    n = float(np.linalg.norm(vec))
    if n > 0:
        vec = vec / n
    return [float(x) for x in vec.astype(np.float32).tolist()]


def _embed_onnx(pil_image) -> list[float]:
    """Learned DINOv2-small embedding (CLS token), fit to 512 dims.

    Falls back to the classical descriptor (never raises) if the model is
    unavailable or inference fails.
    """
    state = _ensure_onnx()
    if state is None:
        return _embed_classical(pil_image)
    try:
        x = _preprocess_onnx(pil_image, state["preproc"])
        outputs = state["session"].run(None, {state["input_name"]: x})
        out = np.asarray(outputs[0])  # last_hidden_state (1, tokens, hidden)
        if out.ndim == 3:
            cls = out[0, 0, :]  # CLS token
        elif out.ndim == 2:
            cls = out[0, :]  # already pooled
        else:
            cls = out.reshape(-1)
        return _fit_512(cls.astype(np.float32))
    except Exception as e:  # noqa: BLE001 - degrade to classical on any error
        print(f"[embed:onnx] inference failed; falling back to classical: {e}", file=sys.stderr)
        return _embed_classical(pil_image)
