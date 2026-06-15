import type { VisionOptions, VisionProvider } from "@/lib/llm/types";
import { ClaudeVisionProvider } from "@/lib/llm/claude-vision";
import { OllamaVisionProvider } from "@/lib/llm/ollama-vision";
import { NoProviderError, parseMode, type ProviderMode } from "@/lib/llm/router";

/**
 * Pure selection logic for the vision capability: given the two vision providers
 * and a mode, return the ordered list to attempt (primary first, fallback
 * second). Only configured providers are included. In `auto` we prefer Claude
 * when configured (more capable), otherwise the local Ollama vision model; both
 * are listed so an unreachable primary falls back to the other.
 *
 * Mirrors `selectProviders` in the text router so behavior stays consistent.
 */
export function selectVisionProviders(
  mode: ProviderMode,
  claude: VisionProvider,
  ollama: VisionProvider,
): VisionProvider[] {
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
 * Run `vision` against the selected providers in order, falling back to the next
 * on failure. Throws {@link NoProviderError} when nothing is usable.
 */
export async function visionWith(
  providers: VisionProvider[],
  prompt: string,
  imagesB64: string[],
  opts?: VisionOptions,
): Promise<{ text: string; provider: string }> {
  if (providers.length === 0) throw new NoProviderError();

  let lastErr: unknown;
  for (const p of providers) {
    try {
      const text = await p.vision(prompt, imagesB64, opts);
      return { text, provider: p.name };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("All vision providers failed.");
}

/** Build the default vision provider set from the environment. */
export function defaultVisionProviders(): {
  claude: VisionProvider;
  ollama: VisionProvider;
} {
  return { claude: new ClaudeVisionProvider(), ollama: new OllamaVisionProvider() };
}

/** The first usable vision provider for the current env, or `undefined`. */
export function getVisionProvider(): VisionProvider | undefined {
  const { claude, ollama } = defaultVisionProviders();
  return selectVisionProviders(parseMode(process.env.VLM_PROVIDER), claude, ollama)[0];
}

/**
 * Environment-driven entry point: selects the vision backend(s) from
 * `VLM_PROVIDER` (claude | ollama | auto, default auto) and runs the vision call
 * with graceful fallback. Returns the text answer plus the provider that
 * produced it.
 */
export async function chatVisionRouted(
  prompt: string,
  imagesB64: string[],
  opts?: VisionOptions,
): Promise<{ text: string; provider: string }> {
  const { claude, ollama } = defaultVisionProviders();
  const providers = selectVisionProviders(parseMode(process.env.VLM_PROVIDER), claude, ollama);
  return visionWith(providers, prompt, imagesB64, opts);
}
