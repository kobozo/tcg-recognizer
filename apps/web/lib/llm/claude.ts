import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, ChatOptions, LlmProvider } from "@/lib/llm/types";

const DEFAULT_MODEL = "claude-opus-4-8";

/**
 * Whether a model accepts the `temperature` parameter. Current Opus 4.6+/4.7/4.8
 * and Fable families REMOVED sampling params — sending `temperature` returns HTTP
 * 400. Omit it for any model id starting with `claude-opus-4` or `claude-fable`
 * (forward-compatible: covers future point releases in those families).
 */
export function supportsTemperature(model: string): boolean {
  return !/^claude-(opus-4|fable)/.test(model);
}

/**
 * Anthropic Claude backend via the official `@anthropic-ai/sdk`.
 * Model + env conventions mirror the original assistant: `ANTHROPIC_API_KEY`
 * to authenticate, `ASSISTANT_MODEL` to override the model (default
 * `claude-opus-4-8`).
 */
export class ClaudeProvider implements LlmProvider {
  readonly name = "claude";

  private get model(): string {
    return process.env.ASSISTANT_MODEL ?? DEFAULT_MODEL;
  }

  isConfigured(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  async chat(messages: ChatMessage[], opts?: ChatOptions): Promise<string> {
    // Anthropic takes `system` separately from the message list.
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const turns = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
    const includeTemperature =
      opts?.temperature !== undefined && supportsTemperature(this.model);
    const res = await client.messages.create(
      {
        model: this.model,
        max_tokens: opts?.maxTokens ?? 1500,
        ...(includeTemperature ? { temperature: opts.temperature } : {}),
        ...(system ? { system } : {}),
        messages: turns,
      },
      { timeout: opts?.timeoutMs ?? 60_000 },
    );

    return res.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("\n")
      .trim();
  }
}
