import type { Enrichment } from "@/lib/types";

type TcgCard = {
  hp?: string;
  attacks?: { name?: string }[];
  images?: { small?: string };
  cardmarket?: { prices?: { trendPrice?: number; averageSellPrice?: number } };
  tcgplayer?: { prices?: Record<string, { market?: number; mid?: number }> };
};

function priceFromCard(card: TcgCard): string | undefined {
  const cm =
    card.cardmarket?.prices?.trendPrice ?? card.cardmarket?.prices?.averageSellPrice;
  if (typeof cm === "number") return `€${cm.toFixed(2)}`;

  const tp = card.tcgplayer?.prices
    ? Object.values(card.tcgplayer.prices).find(
        (p) => typeof p.market === "number" || typeof p.mid === "number",
      )
    : undefined;
  const tpVal = tp?.market ?? tp?.mid;
  if (typeof tpVal === "number") return `$${tpVal.toFixed(2)}`;

  return undefined;
}

/**
 * Best-effort enrichment from the Pokémon TCG API. Never throws: returns null
 * on any error, timeout or empty result so it can never block a scan result.
 */
export async function enrichCard(name: string): Promise<Enrichment | null> {
  try {
    const query = encodeURIComponent(`name:"${name}"`);
    const url = `https://api.pokemontcg.io/v2/cards?q=${query}&pageSize=1`;

    const headers: Record<string, string> = {};
    if (process.env.POKEMON_TCG_API_KEY) {
      headers["X-Api-Key"] = process.env.POKEMON_TCG_API_KEY;
    }

    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;

    const json = (await res.json()) as { data?: TcgCard[] };
    const card = json.data?.[0];
    if (!card) return null;

    const attacks = card.attacks
      ?.map((a) => a.name)
      .filter((n): n is string => typeof n === "string" && n.length > 0);

    return {
      hp: card.hp,
      attacks: attacks && attacks.length > 0 ? attacks : undefined,
      priceIndicator: priceFromCard(card),
      imageUrl: card.images?.small,
    };
  } catch {
    return null;
  }
}
