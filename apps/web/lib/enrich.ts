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
  cardId?: string,
): Promise<Enrichment | null> {
  const provider = getProvider(game);
  if (!provider) return null;
  try {
    // Preferred: enrich the EXACT recognized card by id (correct HP/attacks/
    // price) rather than guessing by name (which returns an arbitrary printing
    // with different stats).
    if (cardId) {
      const c = await provider.getCard(cardId);
      if (c) {
        return {
          hp: c.hp,
          attacks: c.text,
          price: c.price,
          currency: c.currency,
          imageUrl: c.largeImage ?? c.image,
        };
      }
    }
    // Fallback: no id (stub/legacy scans) → best-effort name lookup.
    return await provider.enrich(name);
  } catch {
    return null;
  }
}
