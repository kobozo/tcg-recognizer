import type { ChatMessage, ChatOptions, LlmProvider } from "@/lib/llm/types";
import { ClaudeProvider } from "@/lib/llm/claude";
import { OllamaProvider } from "@/lib/llm/ollama";

export type ProviderMode = "claude" | "ollama" | "auto";

/**
 * Thrown when no backend can be used at all (none configured, or every attempt
 * failed). The assistant turns this into the existing "not configured" message.
 */
export class NoProviderError extends Error {
  constructor(message = "No LLM provider is configured.") {
    super(message);
    this.name = "NoProviderError";
  }
}

export function parseMode(raw: string | undefined): ProviderMode {
  return raw === "claude" || raw === "ollama" ? raw : "auto";
}

/**
 * Pure selection logic: given the two providers and a mode, return the ordered
 * list of providers to attempt (primary first, fallback second). Only
 * configured providers are included. In `auto` we prefer Claude when configured
 * (more capable), otherwise Ollama; both are listed so an unreachable primary
 * falls back to the other.
 */
export function selectProviders(
  mode: ProviderMode,
  claude: LlmProvider,
  ollama: LlmProvider,
): LlmProvider[] {
  switch (mode) {
    case "claude":
      return claude.isConfigured() ? [claude] : [];
    case "ollama":
      return ollama.isConfigured() ? [ollama] : [];
    case "auto":
    default: {
      const ordered = claude.isConfigured() ? [claude, ollama] : [ollama, claude];
      return ordered.filter((p) => p.isConfigured());
    }
  }
}

/**
 * Run `chat` against the selected providers in order, falling back to the next
 * on failure. Throws {@link NoProviderError} when nothing is usable.
 */
export async function chatWith(
  providers: LlmProvider[],
  messages: ChatMessage[],
  opts?: ChatOptions,
): Promise<string> {
  if (providers.length === 0) throw new NoProviderError();

  let lastErr: unknown;
  for (const p of providers) {
    try {
      return await p.chat(messages, opts);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("All LLM providers failed.");
}

/** Build the default provider set from the environment. */
export function defaultProviders(): { claude: LlmProvider; ollama: LlmProvider } {
  return { claude: new ClaudeProvider(), ollama: new OllamaProvider() };
}

/** The first usable provider for the current env, or `undefined` if none. */
export function getProvider(): LlmProvider | undefined {
  const { claude, ollama } = defaultProviders();
  return selectProviders(parseMode(process.env.LLM_PROVIDER), claude, ollama)[0];
}

/**
 * Environment-driven entry point used by the assistant: selects backend(s) from
 * `LLM_PROVIDER` and runs the chat with graceful fallback.
 */
export async function chatRouted(messages: ChatMessage[], opts?: ChatOptions): Promise<string> {
  const { claude, ollama } = defaultProviders();
  const providers = selectProviders(parseMode(process.env.LLM_PROVIDER), claude, ollama);
  return chatWith(providers, messages, opts);
}
