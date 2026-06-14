/**
 * Learned on-device embedding backend (DINOv2-small via transformers.js).
 *
 * This is the BROWSER/Node counterpart of the Python `_embed_onnx` in
 *   services/inference/app/embedding.py  (and the byte-identical trainer copy).
 * Both sides run the SAME model (`Xenova/dinov2-small`, ONNX), take the CLS
 * token of `last_hidden_state`, L2-normalize, pad/truncate to EXACTLY 512 dims
 * and L2-normalize again, so an embedding computed on-device matches the
 * server's pgvector `vector(512)` index.
 *
 * OPT-IN: only used when `NEXT_PUBLIC_EMBEDDER === "onnx"`. The classical
 * descriptor (lib/clientEmbedding.ts) remains the default. The model is loaded
 * lazily/dynamically so it never bloats the main bundle.
 *
 * Device: prefers `webgpu`, with automatic fallback to `wasm` (CPU). In Node
 * (no WebGPU) it falls back to `wasm`.
 */

export const EMBED_DIM = 512;

const MODEL_ID = "Xenova/dinov2-small";

// transformers.js is dynamically imported so it's only pulled in on the onnx
// path. Types are intentionally loose to avoid a hard build-time dependency on
// the package's type surface.
/* eslint-disable @typescript-eslint/no-explicit-any */
let _modelPromise: Promise<{ model: any; processor: any; RawImage: any }> | null =
  null;

async function loadModel() {
  if (_modelPromise) return _modelPromise;
  _modelPromise = (async () => {
    const tjs: any = await import("@huggingface/transformers");
    const { AutoModel, AutoProcessor, RawImage } = tjs;
    const processor = await AutoProcessor.from_pretrained(MODEL_ID);

    // Try WebGPU first (browser), fall back to wasm (CPU / Node).
    let model: any;
    try {
      model = await AutoModel.from_pretrained(MODEL_ID, { device: "webgpu" });
    } catch {
      model = await AutoModel.from_pretrained(MODEL_ID, { device: "wasm" });
    }
    return { model, processor, RawImage };
  })();
  return _modelPromise;
}

/** L2-normalize, pad/truncate to EXACTLY 512, L2-normalize again. */
function fit512(vec: number[]): number[] {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  let out = vec.slice();
  if (norm > 0) for (let i = 0; i < out.length; i++) out[i] /= norm;

  if (out.length < EMBED_DIM) {
    while (out.length < EMBED_DIM) out.push(0);
  } else if (out.length > EMBED_DIM) {
    out = out.slice(0, EMBED_DIM);
  }

  norm = 0;
  for (let i = 0; i < out.length; i++) norm += out[i] * out[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < out.length; i++) out[i] /= norm;

  return out;
}

/** Run the model on a transformers.js RawImage and extract the CLS embedding. */
async function embedRawImage(rawImage: any): Promise<number[]> {
  const { model, processor } = await loadModel();
  const inputs = await processor(rawImage);
  const outputs = await model(inputs);

  // DINOv2 returns `last_hidden_state` of shape [1, tokens, hidden]; the CLS
  // token is index 0 along the tokens axis. Some exports also expose a pooled
  // output — we prefer last_hidden_state's CLS to match the Python server.
  const lhs = outputs.last_hidden_state ?? outputs.logits ?? outputs[0];
  const data: Float32Array | number[] = Array.from(lhs.data);
  const dims: number[] = lhs.dims;

  let cls: number[];
  if (dims.length === 3) {
    // [1, tokens, hidden] -> first token's hidden vector.
    const hidden = dims[2];
    cls = Array.from(data.slice(0, hidden)) as number[];
  } else if (dims.length === 2) {
    // [1, hidden] (already pooled).
    cls = Array.from(data) as number[];
  } else {
    cls = Array.from(data) as number[];
  }
  return fit512(cls);
}

/**
 * Compute the DINOv2 embedding from an HTMLCanvasElement (browser only).
 * Reads the canvas pixels and feeds them through the shared pipeline.
 */
export async function embedCanvasOnnx(
  canvas: HTMLCanvasElement
): Promise<number[]> {
  const ctx = canvas.getContext("2d");
  if (!ctx) return new Array(EMBED_DIM).fill(0);
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  return embedRgbaOnnx(imageData.data, width, height);
}

/**
 * Compute the DINOv2 embedding from raw RGBA pixels. Works in Node too: we
 * build a transformers.js RawImage (RGBA, 4 channels) directly from the buffer,
 * so no DOM / canvas is required.
 *
 * @param data   RGBA bytes (4 per pixel)
 * @param width  image width
 * @param height image height
 */
export async function embedRgbaOnnx(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): Promise<number[]> {
  const { RawImage } = await loadModel();
  // RawImage(data, width, height, channels). The processor handles RGBA by
  // reading the first 3 channels; we pass 4 channels from the RGBA buffer.
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data.buffer ?? data);
  const raw = new RawImage(u8, width, height, 4);
  // Normalize to RGB so the DINOv2 processor (which expects 3 channels) is happy.
  const rgb = typeof raw.rgb === "function" ? await raw.rgb() : raw;
  return embedRawImage(rgb);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
