// Magic: The Gathering provider — Scryfall (https://scryfall.com/docs/api). Free, no key.
import type { GameCard, GameProvider, GameSet } from "./types";
import type { Enrichment } from "@/lib/types";

const API = "https://api.scryfall.com";
const UA = { "User-Agent": "tcg-recognizer/1.0", Accept: "application/json" };

type ScryfallSet = {
  code: string;
  name: string;
  set_type?: string;
  released_at?: string;
  card_count?: number;
  icon_svg_uri?: string;
};

type ScryfallCard = {
  id: string;
  name: string;
  collector_number?: string;
  rarity?: string;
  image_uris?: { small?: string; normal?: string };
  card_faces?: { image_uris?: { small?: string } }[];
};

function mapSet(s: ScryfallSet): GameSet {
  return {
    id: s.code,
    name: s.name,
    series: s.set_type ?? "expansion",
    total: s.card_count ?? 0,
    releaseDate: s.released_at ?? "",
    logo: s.icon_svg_uri,
    symbol: s.icon_svg_uri,
  };
}

export const magicProvider: GameProvider = {
  async listSets() {
    try {
      const res = await fetch(`${API}/sets`, {
        headers: UA,
        next: { revalidate: 86400 },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return [];
      const json = (await res.json()) as { data: ScryfallSet[] };
      // Only sets that actually have cards, newest first.
      return json.data
        .filter((s) => (s.card_count ?? 0) > 0)
        .sort((a, b) => (b.released_at ?? "").localeCompare(a.released_at ?? ""))
        .map(mapSet);
    } catch {
      return [];
    }
  },

  async getSet(id) {
    try {
      const res = await fetch(`${API}/sets/${encodeURIComponent(id)}`, {
        headers: UA,
        next: { revalidate: 86400 },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      return mapSet((await res.json()) as ScryfallSet);
    } catch {
      return null;
    }
  },

  async getSetCards(setId) {
    const cards: GameCard[] = [];
    let url: string | null =
      `${API}/cards/search?q=${encodeURIComponent(`set:${setId} unique:prints`)}&order=set`;
    try {
      // Follow up to 4 pages (~700 cards) to keep it bounded.
      for (let page = 0; page < 4 && url; page++) {
        const res: Response = await fetch(url, {
          headers: UA,
          next: { revalidate: 86400 },
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) break;
        const json = (await res.json()) as {
          data: ScryfallCard[];
          has_more?: boolean;
          next_page?: string;
        };
        for (const c of json.data) {
          cards.push({
            id: c.id,
            name: c.name,
            number: c.collector_number ?? "",
            rarity: c.rarity,
            image: c.image_uris?.small ?? c.card_faces?.[0]?.image_uris?.small,
          });
        }
        url = json.has_more && json.next_page ? json.next_page : null;
      }
      return cards;
    } catch {
      return cards;
    }
  },

  async enrich(name): Promise<Enrichment | null> {
    try {
      const res = await fetch(
        `${API}/cards/named?fuzzy=${encodeURIComponent(name)}`,
        { headers: UA, next: { revalidate: 21600 }, signal: AbortSignal.timeout(8000) },
      );
      if (!res.ok) return null;
      const c = (await res.json()) as {
        prices?: { usd?: string | null; usd_foil?: string | null; eur?: string | null };
        image_uris?: { normal?: string; small?: string };
        card_faces?: { image_uris?: { normal?: string; small?: string } }[];
      };
      const p = c.prices ?? {};
      let price: number | undefined;
      let currency: string | undefined;
      const usd = Number(p.usd ?? p.usd_foil);
      const eur = Number(p.eur);
      if (Number.isFinite(usd) && usd > 0) {
        price = usd;
        currency = "USD";
      } else if (Number.isFinite(eur) && eur > 0) {
        price = eur;
        currency = "EUR";
      }
      return {
        price,
        currency,
        imageUrl:
          c.image_uris?.normal ??
          c.image_uris?.small ??
          c.card_faces?.[0]?.image_uris?.normal,
      };
    } catch {
      return null;
    }
  },
};
