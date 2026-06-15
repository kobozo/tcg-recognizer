import Anthropic from "@anthropic-ai/sdk";
import type { VisionOptions, VisionProvider } from "@/lib/llm/types";

const DEFAULT_MODEL = "claude-opus-4-8";
const DEFAULT_TIMEOUT_MS = 20_000;

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
          source: { type: "base64" as const, media_type: "image/jpeg" as const, data },
        }),
    );

    const res = await client.messages.create(
      {
        model: this.model,
        max_tokens: opts?.maxTokens ?? 512,
        ...(opts?.temperature !== undefined ? { temperature: opts.temperature } : {}),
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
