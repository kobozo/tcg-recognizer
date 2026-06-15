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

/** Optional generation knobs for a vision call. */
export type VisionOptions = {
  maxTokens?: number;
  temperature?: number;
  /** Per-request timeout (ms). Vision calls keep this short on the scan path. */
  timeoutMs?: number;
};

/**
 * A provider that can answer a single-turn prompt about one or more images.
 * Mirrors {@link LlmProvider} but for the vision-language capability used by the
 * VLM-assisted recognition channel. Implementations wrap a concrete vision model
 * (Anthropic Claude vision, a local Ollama vision model, …) behind one shape so
 * the vision router can pick between them and fall back gracefully.
 */
export interface VisionProvider {
  /** Stable identifier, e.g. "claude" or "ollama". */
  readonly name: string;
  /** True when this provider has enough config (keys/URL) to be attempted. */
  isConfigured(): boolean;
  /**
   * Ask the model `prompt` about the given base64-encoded images (no `data:`
   * prefix) and return the model's text answer.
   */
  vision(prompt: string, imagesB64: string[], opts?: VisionOptions): Promise<string>;
}
