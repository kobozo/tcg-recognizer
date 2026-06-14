/**
 * Browser/Node port of the server-side classical visual descriptor.
 *
 * This reproduces, bit-for-bit, the Python `embed()` in
 *   services/inference/app/embedding.py  (and the byte-identical trainer copy)
 * so that an embedding computed on-device matches the server's pgvector index.
 *
 * Parity requirements honored here (must NOT drift from the Python):
 *  - All resizes use NEAREST-NEIGHBOR with index math
 *      src = floor(dst * src_size / dst_size)
 *    (the Python uses _resize_nearest with the same arithmetic).
 *  - Input RGBA is first nearest-resized to 224x224 (matching Python's initial
 *    resize from the source image dimensions to 224x224).
 *  - Grayscale = 0.299*R + 0.587*G + 0.114*B (no rounding; float).
 *  - 4x4 grid: per-cell mean RGB/255 + per-cell grayscale std/128.
 *  - 18x18 block: built from gray cast to uint8 (Math.trunc / floor of a
 *    non-negative value), nearest-resized, mean-subtracted, /128.
 *  - 3x16 color histograms: bin = min(floor(v*16/255), 15), matching numpy's
 *    np.histogram(range=(0,255), bins=16). (Verified equivalent to v/256*16 for
 *    all integer pixel values 0..255.) Normalized by pixel count.
 *  - 36-bin magnitude-weighted orientation histogram with gx/gy central
 *    differences and bin = min(floor((atan2(gy,gx)+pi)/(2pi)*36), 35).
 *  - Concatenate in the same order, pad/truncate to 512, L2-normalize.
 *
 * Pure TypeScript: no DOM dependency in embedRgba, no npm deps. Runs in Node
 * and in the browser.
 */

export const EMBED_DIM = 512;

/**
 * Nearest-neighbor resample of an interleaved-channel image.
 *
 * `src` holds `srcH * srcW * channels` values in row-major, channel-last order.
 * Returns a Float64Array of `dstH * dstW * channels` in the same layout.
 * Index math matches the Python `_resize_nearest`:
 *   src_y = floor(oy * srcH / dstH), src_x = floor(ox * srcW / dstW).
 */
function resizeNearest(
  src: ArrayLike<number>,
  srcH: number,
  srcW: number,
  channels: number,
  dstH: number,
  dstW: number
): Float64Array {
  const out = new Float64Array(dstH * dstW * channels);
  for (let oy = 0; oy < dstH; oy++) {
    const sy = Math.floor((oy * srcH) / dstH);
    for (let ox = 0; ox < dstW; ox++) {
      const sx = Math.floor((ox * srcW) / dstW);
      const srcBase = (sy * srcW + sx) * channels;
      const dstBase = (oy * dstW + ox) * channels;
      for (let c = 0; c < channels; c++) {
        out[dstBase + c] = src[srcBase + c];
      }
    }
  }
  return out;
}

/**
 * Compute the 512-d L2-normalized descriptor from raw RGBA pixels.
 *
 * @param data   RGBA bytes (4 per pixel), e.g. canvas getImageData().data
 * @param width  source image width
 * @param height source image height
 */
export function embedRgba(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): number[] {
  // --- Initial nearest-neighbor resize RGBA(width x height) -> 224x224. ---
  // We resize all 4 RGBA channels (cheap) then drop alpha, mirroring the
  // Python which resizes the RGB image; alpha is unused thereafter.
  const S = 224;
  const resized = resizeNearest(data, height, width, 4, S, S); // RGBA, 224x224

  // rgb[y][x][c] flattened; gray[y][x].
  const rgb = new Float64Array(S * S * 3);
  const gray = new Float64Array(S * S);
  for (let i = 0; i < S * S; i++) {
    const r = resized[i * 4 + 0];
    const g = resized[i * 4 + 1];
    const b = resized[i * 4 + 2];
    rgb[i * 3 + 0] = r;
    rgb[i * 3 + 1] = g;
    rgb[i * 3 + 2] = b;
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  const feats: number[] = [];

  // --- (a) 4x4 spatial grid: per-cell mean RGB/255 (3) + gray std/128 (1). ---
  const cells = 4;
  const step = Math.floor(S / cells); // 56
  for (let gyi = 0; gyi < cells; gyi++) {
    for (let gxi = 0; gxi < cells; gxi++) {
      const y0 = gyi * step;
      const y1 = (gyi + 1) * step;
      const x0 = gxi * step;
      const x1 = (gxi + 1) * step;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let gsum = 0;
      let gsq = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const pi = y * S + x;
          sr += rgb[pi * 3 + 0];
          sg += rgb[pi * 3 + 1];
          sb += rgb[pi * 3 + 2];
          const gv = gray[pi];
          gsum += gv;
          gsq += gv * gv;
          n++;
        }
      }
      feats.push(sr / n / 255.0);
      feats.push(sg / n / 255.0);
      feats.push(sb / n / 255.0);
      // population std (numpy default ddof=0): sqrt(mean(g^2) - mean(g)^2)
      const mean = gsum / n;
      let variance = gsq / n - mean * mean;
      if (variance < 0) variance = 0; // guard tiny negative from fp error
      feats.push(Math.sqrt(variance) / 128.0);
    }
  }

  // --- (b) Mean-subtracted downsampled grayscale block (18x18). ---
  // Python casts gray to uint8 (truncation toward zero of a non-negative
  // value -> Math.floor), then nearest-resizes to 18x18.
  const grayU8 = new Float64Array(S * S);
  for (let i = 0; i < S * S; i++) {
    // emulate astype(np.uint8): truncate toward zero, wrap mod 256.
    // gray is always in [0,255] here so this is a plain floor.
    grayU8[i] = Math.floor(gray[i]) & 0xff;
  }
  const small = resizeNearest(grayU8, S, S, 1, 18, 18); // 18x18
  let smallMean = 0;
  for (let i = 0; i < small.length; i++) smallMean += small[i];
  smallMean /= small.length;
  for (let i = 0; i < small.length; i++) {
    feats.push((small[i] - smallMean) / 128.0);
  }

  // --- (c) Per-channel global color histograms (16 bins each). ---
  const npx = S * S;
  for (let ch = 0; ch < 3; ch++) {
    const hist = new Float64Array(16);
    for (let i = 0; i < S * S; i++) {
      const v = rgb[i * 3 + ch];
      // numpy histogram range=(0,255), bins=16: bin edge width = 255/16.
      let bin = Math.floor((v * 16) / 255);
      if (bin > 15) bin = 15;
      if (bin < 0) bin = 0;
      hist[bin] += 1;
    }
    for (let b = 0; b < 16; b++) feats.push(hist[b] / npx);
  }

  // --- (d) Grayscale gradient-orientation histogram (36 bins). ---
  // gx[:,1:-1] = gray[:,2:] - gray[:,:-2]; gy[1:-1,:] = gray[2:,:] - gray[:-2,:]
  const nbins = 36;
  const ohist = new Float64Array(nbins);
  const TWO_PI = 2 * Math.PI;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let gx = 0;
      let gy = 0;
      if (x >= 1 && x <= S - 2) {
        gx = gray[y * S + (x + 1)] - gray[y * S + (x - 1)];
      }
      if (y >= 1 && y <= S - 2) {
        gy = gray[(y + 1) * S + x] - gray[(y - 1) * S + x];
      }
      const mag = Math.sqrt(gx * gx + gy * gy);
      const ang = Math.atan2(gy, gx) + Math.PI; // 0..2pi
      let bin = Math.floor((ang / TWO_PI) * nbins);
      if (bin > nbins - 1) bin = nbins - 1;
      if (bin < 0) bin = 0;
      ohist[bin] += mag;
    }
  }
  let osum = 0;
  for (let b = 0; b < nbins; b++) osum += ohist[b];
  if (osum > 0) {
    for (let b = 0; b < nbins; b++) ohist[b] /= osum;
  }
  for (let b = 0; b < nbins; b++) feats.push(ohist[b]);

  // --- Project/pad/truncate to EXACTLY 512 dims. ---
  let vec: number[];
  if (feats.length < EMBED_DIM) {
    vec = feats.slice();
    while (vec.length < EMBED_DIM) vec.push(0);
  } else {
    vec = feats.slice(0, EMBED_DIM);
  }

  // --- L2-normalize. ---
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) vec[i] = vec[i] / norm;
  }

  return vec;
}

/**
 * Read an HTMLCanvasElement's pixels and compute the descriptor.
 *
 * SSR-guarded: only touches canvas APIs in the browser. Returns a zero vector
 * (length EMBED_DIM) if called where the DOM / 2D context is unavailable.
 */
export async function embedCanvas(canvas: HTMLCanvasElement): Promise<number[]> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    // Server-side render: no canvas. Return a neutral zero vector.
    return new Array(EMBED_DIM).fill(0);
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return new Array(EMBED_DIM).fill(0);
  }
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  return embedRgba(imageData.data, width, height);
}
