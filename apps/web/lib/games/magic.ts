// Magic: The Gathering provider — Scryfall (https://scryfall.com/docs/api). Free, no key.
import type {
  CardPrice,
  CatalogCardInput,
  CatalogSetInput,
  GameCard,
  GameCardDetail,
  GameProvider,
  GameSet,
  PriceVariant,
} from "./types";
import { compareCardNumber, pickPreferredPrice, preferredCurrency } from "./types";
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

type FullCard = {
  id: string;
  name: string;
  collector_number?: string;
  rarity?: string;
  image_uris?: { small?: string; normal?: string };
  set?: string;
  set_name?: string;
  released_at?: string;
  type_line?: string;
  oracle_text?: string;
  flavor_text?: string;
  artist?: string;
  finishes?: string[];
  prices?: {
    usd?: string | null;
    usd_foil?: string | null;
    usd_etched?: string | null;
    eur?: string | null;
  };
  card_faces?: { image_uris?: { small?: string; normal?: string }; oracle_text?: string }[];
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
      return cards.sort((a, b) => compareCardNumber(a.number, b.number));
    } catch {
      return cards;
    }
  },

  async getCard(id): Promise<GameCardDetail | null> {
    try {
      const res = await fetch(`${API}/cards/${encodeURIComponent(id)}`, {
        headers: UA,
        next: { revalidate: 86400 },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const c = (await res.json()) as FullCard;
      const img =
        c.image_uris?.normal ??
        c.image_uris?.small ??
        c.card_faces?.[0]?.image_uris?.normal;
      const oracle = c.oracle_text ?? c.card_faces?.map((f) => f.oracle_text).filter(Boolean).join("\n");
      const { variants, ...prices } = magicPrices(c);
      const { price, currency } = pickPreferredPrice(prices);
      return {
        variants,
        id: c.id,
        name: c.name,
        number: c.collector_number ?? "",
        rarity: c.rarity,
        image: c.image_uris?.small ?? c.card_faces?.[0]?.image_uris?.small,
        largeImage: img,
        setId: c.set,
        setName: c.set_name,
        releaseDate: c.released_at ?? "",
        types: c.type_line ? [c.type_line] : undefined,
        artist: c.artist,
        flavorText: c.flavor_text,
        text: oracle ? oracle.split("\n").filter(Boolean) : undefined,
        price,
        currency,
      };
    } catch {
      return null;
    }
  },

  async getPrintings(name): Promise<GameCard[]> {
    const cards: GameCard[] = [];
    let url: string | null = `${API}/cards/search?q=${encodeURIComponent(
      `!"${name.replace(/"/g, "")}" unique:prints`,
    )}&order=released`;
    try {
      for (let page = 0; page < 4 && url; page++) {
        const res: Response = await fetch(url, {
          headers: UA,
          next: { revalidate: 21600 },
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) break;
        const json = (await res.json()) as {
          data: FullCard[];
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
            setId: c.set,
            setName: c.set_name,
            releaseDate: c.released_at ?? "",
          });
        }
        url = json.has_more && json.next_page ? json.next_page : null;
      }
      return cards;
    } catch {
      return cards;
    }
  },

  async searchCards(query, limit = 24): Promise<GameCard[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    try {
      const res = await fetch(
        `${API}/cards/search?q=${encodeURIComponent(q)}&unique=cards&order=name`,
        { headers: UA, next: { revalidate: 3600 }, signal: AbortSignal.timeout(10000) },
      );
      if (!res.ok) return [];
      const json = (await res.json()) as { data: FullCard[] };
      return json.data.slice(0, limit).map((c) => ({
        id: c.id,
        name: c.name,
        number: c.collector_number ?? "",
        rarity: c.rarity,
        image: c.image_uris?.small ?? c.card_faces?.[0]?.image_uris?.small,
        setId: c.set,
        setName: c.set_name,
        releaseDate: c.released_at ?? "",
      }));
    } catch {
      return [];
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
      const usdN = Number(p.usd ?? p.usd_foil);
      const eurN = Number(p.eur);
      const usd = Number.isFinite(usdN) && usdN > 0 ? usdN : undefined;
      const eur = Number.isFinite(eurN) && eurN > 0 ? eurN : undefined;

      let price: number | undefined;
      let currency: string | undefined;
      // Prefer the deployment's currency (Belgium → EUR by default).
      if (preferredCurrency() === "EUR") {
        if (eur !== undefined) [price, currency] = [eur, "EUR"];
        else if (usd !== undefined) [price, currency] = [usd, "USD"];
      } else {
        if (usd !== undefined) [price, currency] = [usd, "USD"];
        else if (eur !== undefined) [price, currency] = [eur, "EUR"];
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

  // --- Bulk catalogue sync ---

  async fetchAllSets(): Promise<CatalogSetInput[]> {
    const res = await fetch(`${API}/sets`, {
      headers: UA,
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data: ScryfallSet[] };
    return json.data
      .filter((s) => (s.card_count ?? 0) > 0)
      .map((s) => {
        const m = mapSet(s);
        return {
          id: m.id,
          game: "magic" as const,
          name: m.name,
          series: m.series,
          total: m.total,
          releaseDate: m.releaseDate,
          logo: m.logo,
          symbol: m.symbol,
        };
      });
  },

  async fetchAllCards(onBatch): Promise<number> {
    // Scryfall publishes the full card corpus as a single downloadable JSON
    // array ("default_cards", one object per printing). Pulling that once is far
    // friendlier to their API than paging ~500 search requests.
    const meta = await fetch(`${API}/bulk-data`, {
      headers: UA,
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    if (!meta.ok) return 0;
    const list = (await meta.json()) as { data: { type: string; download_uri: string }[] };
    const entry = list.data.find((d) => d.type === "default_cards");
    if (!entry) return 0;
    const dump = await fetch(entry.download_uri, {
      headers: UA,
      cache: "no-store",
      signal: AbortSignal.timeout(120000),
    });
    if (!dump.ok) return 0;
    const cards = (await dump.json()) as FullCard[];
    let total = 0;
    // Batch so each DB write stays bounded.
    for (let i = 0; i < cards.length; i += 250) {
      const batch = cards.slice(i, i + 250).map(magicCardInput);
      await onBatch(batch);
      total += batch.length;
    }
    return total;
  },
};

/** EUR + USD market prices + per-finish variants for a Scryfall card. */
function magicPrices(c: FullCard): CardPrice {
  const eurN = Number(c.prices?.eur);
  const usdN = Number(c.prices?.usd ?? c.prices?.usd_foil);
  const eur = Number.isFinite(eurN) && eurN > 0 ? eurN : undefined;
  const usd = Number.isFinite(usdN) && usdN > 0 ? usdN : undefined;
  const finishPrice: Record<string, string | null | undefined> = {
    nonfoil: c.prices?.usd,
    foil: c.prices?.usd_foil,
    etched: c.prices?.usd_etched,
  };
  const finishLabel: Record<string, string> = {
    nonfoil: "Nonfoil",
    foil: "Foil",
    etched: "Etched",
  };
  const variants: PriceVariant[] = (c.finishes ?? [])
    .filter((f) => f in finishLabel)
    .map((f) => {
      const n = Number(finishPrice[f]);
      return {
        name: finishLabel[f],
        price: Number.isFinite(n) && n > 0 ? n : undefined,
        currency: "USD",
      };
    });
  return { eur, usd, variants };
}

/** Map a full Scryfall card to a catalogue row (static fields + price). */
function magicCardInput(c: FullCard): CatalogCardInput {
  const oracle =
    c.oracle_text ?? c.card_faces?.map((f) => f.oracle_text).filter(Boolean).join("\n");
  return {
    id: c.id,
    game: "magic",
    name: c.name,
    setId: c.set ?? "",
    setName: c.set_name ?? "",
    number: c.collector_number ?? "",
    rarity: c.rarity,
    types: c.type_line ? [c.type_line] : [],
    artist: c.artist,
    flavorText: c.flavor_text,
    text: oracle ? oracle.split("\n").filter(Boolean) : [],
    imageSmall: c.image_uris?.small ?? c.card_faces?.[0]?.image_uris?.small,
    imageLarge:
      c.image_uris?.normal ?? c.image_uris?.small ?? c.card_faces?.[0]?.image_uris?.normal,
    releaseDate: c.released_at ?? "",
    price: magicPrices(c),
  };
}
