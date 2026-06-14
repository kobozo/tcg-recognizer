import type { Enrichment } from "@/lib/types";
import { getProvider } from "@/lib/games";

/**
 * Best-effort enrichment (metadata + market value) for a card, delegated to the
 * game's provider. Never throws: returns null on any error so it can't block a
 * scan result.
 */
export async function enrichCard(
  name: string,
  game = "pokemon",
): Promise<Enrichment | null> {
  const provider = getProvider(game);
  if (!provider) return null;
  try {
    return await provider.enrich(name);
  } catch {
    return null;
  }
}
