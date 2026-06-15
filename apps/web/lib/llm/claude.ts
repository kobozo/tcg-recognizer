import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, ChatOptions, LlmProvider } from "@/lib/llm/types";

const DEFAULT_MODEL = "claude-opus-4-8";

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
    const res = await client.messages.create({
      model: this.model,
      max_tokens: opts?.maxTokens ?? 1500,
      ...(opts?.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(system ? { system } : {}),
      messages: turns,
    });

    return res.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("\n")
      .trim();
  }
}
