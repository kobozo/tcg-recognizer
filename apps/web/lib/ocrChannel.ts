import type { Prediction } from "@/lib/types";

// The opt-in OCR + Qdrant text-search service (Docker Compose `extras` profile).
const OCR_URL = process.env.OCR_URL ?? "http://ocr:8002";

/**
 * Is the OCR + Qdrant "teach our model" channel enabled for this deployment?
 * Gated so the default stack (and CI) never depends on the `extras` services.
 */
export function ocrEnabled(): boolean {
  const v = (process.env.OCR_ENABLED ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

type OcrSearchResult = {
  name?: string;
  set?: string;
  number?: string;
  score?: number;
};

/**
 * Turn raw Qdrant text-search hits into ranked name candidates, deduped by
 * name (case-insensitive) and with the cosine score clamped into [0,1] as the
 * candidate confidence.
 */
export function ocrResultsToCandidates(results: OcrSearchResult[]): Prediction[] {
  const out: Prediction[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    const value = (r.name ?? "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const score = typeof r.score === "number" ? r.score : 0;
    out.push({ value, conf: Math.max(0, Math.min(1, score)) });
  }
  return out;
}

/**
 * Fold OCR-derived candidates into the recognition prediction's candidate list
 * without duplicating the primary name or anything already present. The user
 * confirms/corrects against this combined list; confirmed labels become
 * Feedback rows the trainer folds back into the index — this is how the
 * OCR/Qdrant extra "teaches" the model.
 */
export function mergeOcrCandidates(
  existing: Prediction[] | undefined,
  ocr: Prediction[],
  primaryName: string,
): Prediction[] {
  const merged = [...(existing ?? [])];
  const seen = new Set(
    [primaryName, ...merged.map((c) => c.value)].map((v) => v.trim().toLowerCase()),
  );
  for (const c of ocr) {
    const key = c.value.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(c);
  }
  return merged;
}

/**
 * Query the opt-in OCR + Qdrant text channel for a card image. Returns the
 * OCR'd text and ranked name candidates, or null when the channel is disabled
 * or unreachable. Never throws — recognition must not depend on this extra.
 */
export async function ocrChannel(
  image: Blob,
  game: string,
): Promise<{ text: string; candidates: Prediction[] } | null> {
  if (!ocrEnabled()) return null;
  try {
    const form = new FormData();
    form.append("image", image, "card.jpg");
    form.append("game", game);
    const r = await fetch(`${OCR_URL}/ocr_search`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as {
      ocr_text?: string;
      results?: OcrSearchResult[];
    };
    const text = typeof data.ocr_text === "string" ? data.ocr_text.trim() : "";
    return { text, candidates: ocrResultsToCandidates(data.results ?? []) };
  } catch {
    return null;
  }
}
