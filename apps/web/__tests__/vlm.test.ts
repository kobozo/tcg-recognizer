import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  selectVisionProviders,
  visionWith,
} from "../lib/llm/vision-router";
import { NoProviderError } from "../lib/llm/router";
import type { VisionProvider } from "../lib/llm/types";
import { parseVlmJson, matchCandidate, matchCandidateInText } from "../lib/vlm";

/** A controllable fake vision provider for selection + fallback tests. */
function fake(
  name: string,
  configured: boolean,
  reply: string | (() => Promise<string>),
): VisionProvider {
  return {
    name,
    isConfigured: () => configured,
    vision:
      typeof reply === "function"
        ? (async () => (reply as () => Promise<string>)())
        : vi.fn(async () => reply),
  };
}

describe("selectVisionProviders", () => {
  it("VLM_PROVIDER=claude picks only Claude, and only when configured", () => {
    const claude = fake("claude", true, "c");
    const ollama = fake("ollama", true, "o");
    expect(selectVisionProviders("claude", claude, ollama).map((p) => p.name)).toEqual([
      "claude",
    ]);
    const claudeOff = fake("claude", false, "c");
    expect(selectVisionProviders("claude", claudeOff, ollama)).toEqual([]);
  });

  it("VLM_PROVIDER=ollama picks only Ollama, and only when configured", () => {
    const claude = fake("claude", true, "c");
    const ollama = fake("ollama", true, "o");
    expect(selectVisionProviders("ollama", claude, ollama).map((p) => p.name)).toEqual([
      "ollama",
    ]);
    const ollamaOff = fake("ollama", false, "o");
    expect(selectVisionProviders("ollama", claude, ollamaOff)).toEqual([]);
  });

  it("auto prefers Claude when configured, with Ollama as fallback", () => {
    const claude = fake("claude", true, "c");
    const ollama = fake("ollama", true, "o");
    expect(selectVisionProviders("auto", claude, ollama).map((p) => p.name)).toEqual([
      "claude",
      "ollama",
    ]);
  });

  it("auto falls to Ollama-first when Claude is not configured", () => {
    const claude = fake("claude", false, "c");
    const ollama = fake("ollama", true, "o");
    expect(selectVisionProviders("auto", claude, ollama).map((p) => p.name)).toEqual([
      "ollama",
    ]);
  });

  it("auto returns nothing when neither is configured", () => {
    const claude = fake("claude", false, "c");
    const ollama = fake("ollama", false, "o");
    expect(selectVisionProviders("auto", claude, ollama)).toEqual([]);
  });
});

describe("visionWith", () => {
  it("returns the primary provider's reply and its name", async () => {
    const claude = fake("claude", true, "from-claude");
    const ollama = fake("ollama", true, "from-ollama");
    await expect(visionWith([claude, ollama], "p", ["b64"])).resolves.toEqual({
      text: "from-claude",
      provider: "claude",
    });
  });

  it("falls back to the next provider when the primary throws", async () => {
    const failing = fake("claude", true, async () => {
      throw new Error("unreachable");
    });
    const ollama = fake("ollama", true, "from-ollama");
    await expect(visionWith([failing, ollama], "p", ["b64"])).resolves.toEqual({
      text: "from-ollama",
      provider: "ollama",
    });
  });

  it("rethrows the last error when every provider fails", async () => {
    const a = fake("claude", true, async () => {
      throw new Error("claude down");
    });
    const b = fake("ollama", true, async () => {
      throw new Error("ollama down");
    });
    await expect(visionWith([a, b], "p", ["b64"])).rejects.toThrow("ollama down");
  });

  it("throws NoProviderError when none are usable", async () => {
    await expect(visionWith([], "p", ["b64"])).rejects.toBeInstanceOf(NoProviderError);
  });
});

describe("parseVlmJson", () => {
  it("parses a plain JSON object", () => {
    expect(parseVlmJson('{"pick":"Pikachu","name":"Pikachu"}')).toEqual({
      pick: "Pikachu",
      name: "Pikachu",
    });
  });

  it("strips ```json code fences", () => {
    const raw = '```json\n{"pick":"Charizard","hp":"120"}\n```';
    expect(parseVlmJson(raw)).toEqual({ pick: "Charizard", hp: "120" });
  });

  it("strips bare ``` fences", () => {
    const raw = '```\n{"pick":"Mewtwo"}\n```';
    expect(parseVlmJson(raw)).toEqual({ pick: "Mewtwo" });
  });

  it("tolerates surrounding prose", () => {
    const raw = 'Sure! Here is the card:\n{"pick":"Bulbasaur","number":"1"}\nHope that helps.';
    expect(parseVlmJson(raw)).toEqual({ pick: "Bulbasaur", number: "1" });
  });

  it("returns null for non-JSON / empty input", () => {
    expect(parseVlmJson("")).toBeNull();
    expect(parseVlmJson("I cannot read this card.")).toBeNull();
    expect(parseVlmJson("[1,2,3]")).toBeNull();
  });
});

describe("matchCandidate", () => {
  const cands = ["Pikachu", "Raichu", "Charizard"];

  it("matches case-insensitively", () => {
    expect(matchCandidate("pikachu", cands)).toBe("Pikachu");
    expect(matchCandidate("  CHARIZARD ", cands)).toBe("Charizard");
  });

  it("returns null when the read is not in the list", () => {
    expect(matchCandidate("Mewtwo", cands)).toBeNull();
    expect(matchCandidate("", cands)).toBeNull();
  });
});

describe("matchCandidateInText", () => {
  const cands = ["Charizard", "Blastoise", "Venusaur"];

  it("recovers a candidate named in free-text prose (small local VLMs)", () => {
    expect(matchCandidateInText("This card is a Blastoise.", cands)).toBe("Blastoise");
    expect(matchCandidateInText("blastoise", cands)).toBe("Blastoise");
  });

  it("returns null when no candidate appears and on empty input", () => {
    expect(matchCandidateInText("a wild Mewtwo appeared", cands)).toBeNull();
    expect(matchCandidateInText("", cands)).toBeNull();
  });
});

describe("vlmDisambiguate gating", () => {
  const ORIGINAL = process.env.VLM_ASSIST;

  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.VLM_ASSIST;
    else process.env.VLM_ASSIST = ORIGINAL;
  });

  it("returns null when disabled (default OFF), without calling the router", async () => {
    delete process.env.VLM_ASSIST;
    const routed = vi.fn();
    vi.doMock("../lib/llm/vision-router", () => ({ chatVisionRouted: routed }));
    const { vlmDisambiguate, vlmEnabled } = await import("../lib/vlm");
    expect(vlmEnabled()).toBe(false);
    await expect(
      vlmDisambiguate(Buffer.from([1, 2, 3]), ["Pikachu"]),
    ).resolves.toBeNull();
    expect(routed).not.toHaveBeenCalled();
  });

  it("returns null and never throws when the router fails (unconfigured backend)", async () => {
    process.env.VLM_ASSIST = "1";
    const routed = vi.fn(async () => {
      throw new NoProviderError();
    });
    vi.doMock("../lib/llm/vision-router", () => ({ chatVisionRouted: routed }));
    const { vlmDisambiguate } = await import("../lib/vlm");
    await expect(
      vlmDisambiguate(Buffer.from([1, 2, 3]), ["Pikachu"]),
    ).resolves.toBeNull();
    expect(routed).toHaveBeenCalledTimes(1);
  });

  it("constrains the pick to a candidate and surfaces the read text", async () => {
    process.env.VLM_ASSIST = "1";
    const routed = vi.fn(async () => ({
      text: '{"pick":"pikachu","name":"Pikachu","number":"58","hp":"60"}',
      provider: "ollama",
    }));
    vi.doMock("../lib/llm/vision-router", () => ({ chatVisionRouted: routed }));
    const { vlmDisambiguate } = await import("../lib/vlm");
    const res = await vlmDisambiguate(Buffer.from([1, 2, 3]), ["Raichu", "Pikachu"]);
    expect(res).toEqual({
      pick: "Pikachu",
      text: "Pikachu · #58 · HP 60",
      provider: "ollama",
    });
  });

  it("keeps pick null when the VLM read is not in the shortlist", async () => {
    process.env.VLM_ASSIST = "1";
    const routed = vi.fn(async () => ({
      text: '{"pick":"Mewtwo","name":"Mewtwo"}',
      provider: "claude",
    }));
    vi.doMock("../lib/llm/vision-router", () => ({ chatVisionRouted: routed }));
    const { vlmDisambiguate } = await import("../lib/vlm");
    const res = await vlmDisambiguate(Buffer.from([1, 2, 3]), ["Pikachu", "Raichu"]);
    expect(res).toEqual({ pick: null, text: "Mewtwo", provider: "claude" });
  });

  it("returns null on unparseable VLM output", async () => {
    process.env.VLM_ASSIST = "1";
    const routed = vi.fn(async () => ({
      text: "I'm not sure what this card is.",
      provider: "ollama",
    }));
    vi.doMock("../lib/llm/vision-router", () => ({ chatVisionRouted: routed }));
    const { vlmDisambiguate } = await import("../lib/vlm");
    await expect(
      vlmDisambiguate(Buffer.from([1, 2, 3]), ["Pikachu"]),
    ).resolves.toBeNull();
  });

  it("recovers the pick from free-text prose when the VLM ignores the JSON ask", async () => {
    process.env.VLM_ASSIST = "1";
    const routed = vi.fn(async () => ({
      text: "This is clearly a Blastoise card.",
      provider: "ollama",
    }));
    vi.doMock("../lib/llm/vision-router", () => ({ chatVisionRouted: routed }));
    const { vlmDisambiguate } = await import("../lib/vlm");
    const res = await vlmDisambiguate(
      Buffer.from([1, 2, 3]),
      ["Charizard", "Blastoise", "Venusaur"],
    );
    expect(res?.pick).toBe("Blastoise");
    expect(res?.provider).toBe("ollama");
  });
});
