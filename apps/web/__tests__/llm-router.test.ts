import { describe, it, expect, vi } from "vitest";
import {
  parseMode,
  selectProviders,
  chatWith,
  NoProviderError,
} from "../lib/llm/router";
import type { LlmProvider } from "../lib/llm/types";

/** A controllable fake provider for selection + fallback tests (no network). */
function fake(
  name: string,
  configured: boolean,
  reply: string | (() => Promise<string>),
): LlmProvider {
  return {
    name,
    isConfigured: () => configured,
    chat:
      typeof reply === "function"
        ? (reply as LlmProvider["chat"])
        : vi.fn(async () => reply),
  };
}

describe("parseMode", () => {
  it("recognizes explicit modes and defaults the rest to auto", () => {
    expect(parseMode("claude")).toBe("claude");
    expect(parseMode("ollama")).toBe("ollama");
    expect(parseMode("auto")).toBe("auto");
    expect(parseMode(undefined)).toBe("auto");
    expect(parseMode("nonsense")).toBe("auto");
  });
});

describe("selectProviders", () => {
  it("LLM_PROVIDER=claude picks only Claude, and only when configured", () => {
    const claude = fake("claude", true, "c");
    const ollama = fake("ollama", true, "o");
    expect(selectProviders("claude", claude, ollama).map((p) => p.name)).toEqual([
      "claude",
    ]);

    const claudeOff = fake("claude", false, "c");
    expect(selectProviders("claude", claudeOff, ollama)).toEqual([]);
  });

  it("LLM_PROVIDER=ollama picks only Ollama, and only when configured", () => {
    const claude = fake("claude", true, "c");
    const ollama = fake("ollama", true, "o");
    expect(selectProviders("ollama", claude, ollama).map((p) => p.name)).toEqual([
      "ollama",
    ]);

    const ollamaOff = fake("ollama", false, "o");
    expect(selectProviders("ollama", claude, ollamaOff)).toEqual([]);
  });

  it("auto prefers Claude when configured, with Ollama as fallback", () => {
    const claude = fake("claude", true, "c");
    const ollama = fake("ollama", true, "o");
    expect(selectProviders("auto", claude, ollama).map((p) => p.name)).toEqual([
      "claude",
      "ollama",
    ]);
  });

  it("auto falls to Ollama-first when Claude is not configured", () => {
    const claude = fake("claude", false, "c");
    const ollama = fake("ollama", true, "o");
    expect(selectProviders("auto", claude, ollama).map((p) => p.name)).toEqual([
      "ollama",
    ]);
  });

  it("auto returns nothing when neither is configured", () => {
    const claude = fake("claude", false, "c");
    const ollama = fake("ollama", false, "o");
    expect(selectProviders("auto", claude, ollama)).toEqual([]);
  });
});

describe("chatWith", () => {
  it("returns the primary provider's reply", async () => {
    const claude = fake("claude", true, "from-claude");
    const ollama = fake("ollama", true, "from-ollama");
    await expect(chatWith([claude, ollama], [{ role: "user", content: "hi" }])).resolves.toBe(
      "from-claude",
    );
  });

  it("falls back to the next provider when the primary throws", async () => {
    const failing = fake("claude", true, async () => {
      throw new Error("unreachable");
    });
    const ollama = fake("ollama", true, "from-ollama");
    await expect(chatWith([failing, ollama], [{ role: "user", content: "hi" }])).resolves.toBe(
      "from-ollama",
    );
  });

  it("rethrows the last error when every provider fails", async () => {
    const a = fake("claude", true, async () => {
      throw new Error("claude down");
    });
    const b = fake("ollama", true, async () => {
      throw new Error("ollama down");
    });
    await expect(
      chatWith([a, b], [{ role: "user", content: "hi" }]),
    ).rejects.toThrow("ollama down");
  });

  it("throws NoProviderError (the inert sentinel) when none are usable", async () => {
    await expect(chatWith([], [{ role: "user", content: "hi" }])).rejects.toBeInstanceOf(
      NoProviderError,
    );
  });
});
