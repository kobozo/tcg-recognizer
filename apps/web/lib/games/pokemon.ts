// Pokémon provider — Pokémon TCG API (https://docs.pokemontcg.io). Free; set
// POKEMON_TCG_API_KEY for higher rate limits.
import type { GameCard, GameProvider, GameSet } from "./types";
import type { Enrichment } from "@/lib/types";

const API = "https://api.pokemontcg.io/v2";

function headers(): HeadersInit {
  const key = process.env.POKEMON_TCG_API_KEY;
  return key ? { "X-Api-Key": key } : {};
}

type ApiSet = {
  id: string;
  name: string;
  series: string;
  total?: number;
  printedTotal?: number;
  releaseDate?: string;
  images?: { logo?: string; symbol?: string };
};

type ApiCard = {
  id: string;
  name: string;
  number?: string;
  rarity?: string;
  images?: { small?: string; large?: string };
};

function mapSet(s: ApiSet): GameSet {
  return {
    id: s.id,
    name: s.name,
    series: s.series,
    total: s.total ?? s.printedTotal ?? 0,
    releaseDate: s.releaseDate ? s.releaseDate.replaceAll("/", "-") : "",
    logo: s.images?.logo,
    symbol: s.images?.symbol,
  };
}

export const pokemonProvider: GameProvider = {
  async listSets() {
    try {
      const res = await fetch(
        `${API}/sets?orderBy=-releaseDate&select=id,name,series,total,releaseDate,images`,
        { headers: headers(), next: { revalidate: 86400 }, signal: AbortSignal.timeout(8000) },
      );
      if (!res.ok) return [];
      const json = (await res.json()) as { data: ApiSet[] };
      return json.data.map(mapSet);
    } catch {
      return [];
    }
  },

  async getSet(id) {
    try {
      const res = await fetch(`${API}/sets/${encodeURIComponent(id)}`, {
        headers: headers(),
        next: { revalidate: 86400 },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { data: ApiSet };
      return mapSet(json.data);
    } catch {
      return null;
    }
  },

  async getSetCards(setId) {
    try {
      const res = await fetch(
        `${API}/cards?q=set.id:${encodeURIComponent(setId)}&pageSize=250&orderBy=number&select=id,name,number,rarity,images`,
        { headers: headers(), next: { revalidate: 86400 }, signal: AbortSignal.timeout(10000) },
      );
      if (!res.ok) return [];
      const json = (await res.json()) as { data: ApiCard[] };
      return json.data.map((c) => ({
        id: c.id,
        name: c.name,
        number: c.number ?? "",
        rarity: c.rarity,
        image: c.images?.small,
      }));
    } catch {
      return [];
    }
  },

  async enrich(name): Promise<Enrichment | null> {
    try {
      const q = encodeURIComponent(`name:"${name}"`);
      const res = await fetch(`${API}/cards?q=${q}&pageSize=1`, {
        headers: headers(),
        next: { revalidate: 21600 },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { data: PriceCard[] };
      const c = json.data?.[0];
      if (!c) return null;

      // Prefer TCGplayer market price (USD); fall back to Cardmarket trend (EUR).
      let price: number | undefined;
      let currency: string | undefined;
      const tp = c.tcgplayer?.prices ?? {};
      const markets = Object.values(tp)
        .map((p) => p?.market)
        .filter((n): n is number => typeof n === "number" && n > 0);
      if (markets.length > 0) {
        price = Math.max(...markets);
        currency = "USD";
      } else if (typeof c.cardmarket?.prices?.trendPrice === "number") {
        price = c.cardmarket.prices.trendPrice;
        currency = "EUR";
      }

      return {
        hp: c.hp,
        attacks: c.attacks?.map((a) => a.name),
        price,
        currency,
        imageUrl: c.images?.large ?? c.images?.small,
      };
    } catch {
      return null;
    }
  },
};

type PriceCard = {
  hp?: string;
  attacks?: { name: string }[];
  images?: { small?: string; large?: string };
  tcgplayer?: { prices?: Record<string, { market?: number } | null> };
  cardmarket?: { prices?: { trendPrice?: number } };
};
