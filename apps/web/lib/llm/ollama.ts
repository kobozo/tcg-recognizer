import type { ChatMessage, ChatOptions, LlmProvider } from "@/lib/llm/types";

const DEFAULT_URL = "http://ollama:11434";
const DEFAULT_MODEL = "llama3.2:1b";
const TIMEOUT_MS = 30_000;

type OllamaChatResponse = {
  message?: { content?: string };
  error?: string;
};

/**
 * Local LLM backend that talks to an Ollama server over HTTP. Uses the native
 * non-streaming `POST /api/chat` endpoint (`{message:{content}}`).
 *
 * `isConfigured()` is true whenever an `OLLAMA_URL` is available (it defaults
 * on), but `chat()` fails loudly with a clear error if the server is
 * unreachable or slow, so the router can fall back to another provider.
 */
export class OllamaProvider implements LlmProvider {
  readonly name = "ollama";

  private get url(): string {
    return process.env.OLLAMA_URL ?? DEFAULT_URL;
  }

  private get model(): string {
    return process.env.OLLAMA_MODEL ?? DEFAULT_MODEL;
  }

  isConfigured(): boolean {
    // OLLAMA_URL defaults on, so Ollama is considered "available" by default.
    // Reachability is verified lazily in chat() with a short timeout.
    return Boolean(this.url);
  }

  async chat(messages: ChatMessage[], opts?: ChatOptions): Promise<string> {
    const endpoint = `${this.url.replace(/\/$/, "")}/api/chat`;
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          options: {
            ...(opts?.temperature !== undefined ? { temperature: opts.temperature } : {}),
            ...(opts?.maxTokens !== undefined ? { num_predict: opts.maxTokens } : {}),
          },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      throw new Error(`Ollama unreachable at ${this.url}: ${reason}`);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Ollama request failed (${res.status})${detail ? `: ${detail}` : ""}`);
    }

    const data = (await res.json()) as OllamaChatResponse;
    if (data.error) throw new Error(`Ollama error: ${data.error}`);
    return (data.message?.content ?? "").trim();
  }
}
