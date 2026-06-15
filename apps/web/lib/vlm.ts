import { chatVisionRouted } from "@/lib/llm/vision-router";

// Generous: a local CPU vision model (llava) generates slowly. Override with
// VLM_TIMEOUT_MS. Claude returns well within this.
const VLM_TIMEOUT_MS = Number(process.env.VLM_TIMEOUT_MS) || 60_000;
// Keep the reply short so CPU-bound local models stay within the timeout.
const VLM_MAX_TOKENS = Number(process.env.VLM_MAX_TOKENS) || 160;

/**
 * Is the VLM-assisted recognition channel enabled for this deployment? Gated so
 * the default stack (and CI) never calls a vision model. Off by default; enable
 * with `VLM_ASSIST=1` (also accepts true/yes/on) AND a usable vision backend
 * (`ANTHROPIC_API_KEY` for Claude, or a reachable Ollama vision model).
 */
export function vlmEnabled(): boolean {
  const v = (process.env.VLM_ASSIST ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export type VlmReading = {
  /** A candidate name (when the read matches the shortlist) or null. */
  pick: string | null;
  /** The card text the VLM read (name/number/hp), for explainability. */
  text: string;
  /** Which backend answered, e.g. "claude" or "ollama". */
  provider: string;
};

type VlmJson = {
  pick?: unknown;
  name?: unknown;
  number?: unknown;
  hp?: unknown;
};

/**
 * Best-effort parse of a possibly-noisy VLM reply into the JSON object we asked
 * for. Strips Markdown code fences and tolerates extra prose by extracting the
 * first balanced-looking `{…}` block. Returns null when nothing parses.
 */
export function parseVlmJson(raw: string): VlmJson | null {
  if (!raw) return null;
  // Drop ```json … ``` fences (and bare ``` fences) anywhere in the text.
  let s = raw.replace(/```(?:json)?/gi, "```").replace(/```/g, "").trim();

  // Try the whole string first, then the first {...} slice (tolerates prose).
  const candidates: string[] = [];
  if (s.startsWith("{") && s.endsWith("}")) candidates.push(s);
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(s.slice(first, last + 1));
  candidates.push(s);

  for (const c of candidates) {
    try {
      const parsed: unknown = JSON.parse(c);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as VlmJson;
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function asText(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Constrain a VLM-read name to the candidate shortlist (case-insensitive). When
 * the read isn't in the list, return null so the caller keeps the existing top
 * prediction rather than trusting an off-list guess.
 */
export function matchCandidate(read: string, candidates: string[]): string | null {
  const want = read.trim().toLowerCase();
  if (!want) return null;
  const exact = candidates.find((c) => c.trim().toLowerCase() === want);
  return exact ?? null;
}

/**
 * Free-text fallback: find a candidate name appearing anywhere in a noisy VLM
 * reply (case-insensitive). Smaller local vision models (e.g. llava) often reply
 * in prose like "This is a Blastoise card" instead of the requested JSON; this
 * still recovers the pick. Longest candidate first, to avoid a short name
 * matching inside a longer one.
 */
export function matchCandidateInText(raw: string, candidates: string[]): string | null {
  const hay = (raw || "").toLowerCase();
  if (!hay) return null;
  const sorted = candidates
    .map((c) => c.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const c of sorted) {
    if (hay.includes(c.toLowerCase())) return c;
  }
  return null;
}

/** Build the human-readable "AI read" summary from the parsed fields. */
function summarizeReading(json: VlmJson): string {
  const parts: string[] = [];
  const name = asText(json.name);
  const number = asText(json.number);
  const hp = asText(json.hp);
  if (name) parts.push(name);
  if (number) parts.push(`#${number}`);
  if (hp) parts.push(`HP ${hp}`);
  return parts.join(" · ");
}

const PROMPT_HEAD =
  "You are reading a trading card from a photo. Read the card's printed text and " +
  "identify it. Reply with ONLY a JSON object (no prose, no code fences) of the " +
  'form {"pick": "<one of the candidate names, or your best read of the name>", ' +
  '"name": "<card name>", "number": "<collector number>", "hp": "<hp if present>"}. ' +
  "Choose `pick` from the candidate list below when one matches what you see; " +
  "otherwise set `pick` to the name you read.";

/**
 * Ask a vision-language model to disambiguate a recognizer shortlist by READING
 * the photographed card. Returns the constrained pick (a candidate, when the
 * read matches one), the read text for explainability, and the backend used.
 *
 * Best-effort and never throws: returns null when disabled, when no vision
 * backend is usable, or on any error/timeout. Keep the scan path safe.
 */
export async function vlmDisambiguate(
  imageBytes: Buffer | Uint8Array,
  candidates: string[],
): Promise<VlmReading | null> {
  if (!vlmEnabled()) return null;
  if (!imageBytes || imageBytes.length === 0) return null;

  const list = candidates.map((c) => c.trim()).filter(Boolean);
  const prompt =
    `${PROMPT_HEAD}\n\nCandidate names:\n` +
    (list.length > 0 ? list.map((c) => `- ${c}`).join("\n") : "(none provided)");

  try {
    const b64 = Buffer.from(imageBytes).toString("base64");
    const { text: raw, provider } = await chatVisionRouted(prompt, [b64], {
      maxTokens: VLM_MAX_TOKENS,
      timeoutMs: VLM_TIMEOUT_MS,
    });

    if (!raw || !raw.trim()) return null;

    // Capable models (Claude) return the requested JSON; small local VLMs often
    // reply in prose — handle both.
    const json = parseVlmJson(raw);
    const readPick = json ? asText(json.pick) || asText(json.name) : "";

    // Constrain to the shortlist: exact JSON pick, else any candidate named in
    // the free text.
    const pick =
      matchCandidate(readPick, list) ?? matchCandidateInText(raw, list);

    // Nothing useful (no JSON read and no candidate named in the reply) -> null,
    // so the caller keeps the existing prediction and stores no noisy "AI read".
    if (!json && !pick) return null;

    const text =
      (json ? summarizeReading(json) : "") || readPick || raw.trim().slice(0, 120);

    return { pick, text, provider };
  } catch {
    // NoProviderError, unreachable backend, timeout, bad JSON — all non-fatal.
    return null;
  }
}
