/** A single chat turn passed to an LLM provider. */
export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/** Optional generation knobs shared across providers. */
export type ChatOptions = {
  maxTokens?: number;
  temperature?: number;
};

/**
 * A minimal, provider-agnostic chat backend. Implementations wrap a concrete
 * model service (Anthropic Claude, a local Ollama server, …) behind one shape so
 * the router can pick between them and fall back gracefully.
 */
export interface LlmProvider {
  /** Stable identifier, e.g. "claude" or "ollama". */
  readonly name: string;
  /** True when this provider has enough config (keys/URL) to be attempted. */
  isConfigured(): boolean;
  /** Run a non-streaming chat completion and return the assistant text. */
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<string>;
}
