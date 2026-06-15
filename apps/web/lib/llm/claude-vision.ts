import Anthropic from "@anthropic-ai/sdk";
import type { VisionOptions, VisionProvider } from "@/lib/llm/types";

const DEFAULT_MODEL = "claude-opus-4-8";
const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Whether a model accepts the `temperature` parameter. Current Opus 4.6+/4.7/4.8
 * and Fable families REMOVED sampling params — sending `temperature` returns HTTP
 * 400. Omit it for any model id starting with `claude-opus-4` or `claude-fable`
 * (forward-compatible: covers future point releases in those families).
 */
function supportsTemperature(model: string): boolean {
  return !/^claude-(opus-4|fable)/.test(model);
}

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

/**
 * Detect the image media type from a base64 payload's leading bytes. Anthropic
 * rejects (HTTP 400) any image whose declared media_type doesn't match the
 * actual bytes, so we must not hardcode it (card references are PNG, camera
 * captures are JPEG).
 */
function detectMediaType(b64: string): ImageMediaType {
  if (b64.startsWith("/9j/")) return "image/jpeg";
  if (b64.startsWith("iVBORw0KGgo")) return "image/png";
  if (b64.startsWith("R0lGOD")) return "image/gif";
  if (b64.startsWith("UklGR")) return "image/webp";
  return "image/jpeg"; // sensible default; most photo uploads are JPEG
}

/**
 * Anthropic Claude vision backend via the official `@anthropic-ai/sdk`. Sends
 * the image(s) as base64 content blocks alongside the text prompt in a single
 * `messages.create` turn (no streaming).
 *
 * Env conventions mirror the text Claude provider: `ANTHROPIC_API_KEY` to
 * authenticate, `VLM_MODEL` (falling back to `ASSISTANT_MODEL`) to override the
 * model (default `claude-opus-4-8`).
 */
export class ClaudeVisionProvider implements VisionProvider {
  readonly name = "claude";

  private get model(): string {
    return process.env.VLM_MODEL ?? process.env.ASSISTANT_MODEL ?? DEFAULT_MODEL;
  }

  isConfigured(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  async vision(prompt: string, imagesB64: string[], opts?: VisionOptions): Promise<string> {
    const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
    const images = imagesB64.map(
      (data) =>
        ({
          type: "image" as const,
          source: { type: "base64" as const, media_type: detectMediaType(data), data },
        }),
    );

    const includeTemperature =
      opts?.temperature !== undefined && supportsTemperature(this.model);
    const res = await client.messages.create(
      {
        model: this.model,
        max_tokens: opts?.maxTokens ?? 512,
        ...(includeTemperature ? { temperature: opts.temperature } : {}),
        messages: [{ role: "user", content: [...images, { type: "text", text: prompt }] }],
      },
      { timeout: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS },
    );

    return res.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("\n")
      .trim();
  }
}
