// Pokémon provider — Pokémon TCG API (https://docs.pokemontcg.io). Free; set
// POKEMON_TCG_API_KEY for higher rate limits.
import type {
  CardPrice,
  CatalogCardInput,
  CatalogSetInput,
  GameCard,
  GameCardDetail,
  GameProvider,
  GameSet,
} from "./types";
import { compareCardNumber, pickPreferredPrice } from "./types";
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
      return json.data
        .map((c) => ({
          id: c.id,
          name: c.name,
          number: c.number ?? "",
          rarity: c.rarity,
          image: c.images?.small,
        }))
        // The API sorts `number` lexicographically ("10" before "2"); fix it.
        .sort((a, b) => compareCardNumber(a.number, b.number));
    } catch {
      return [];
    }
  },

  async getCard(id): Promise<GameCardDetail | null> {
    try {
      const res = await fetch(`${API}/cards/${encodeURIComponent(id)}`, {
        headers: headers(),
        next: { revalidate: 86400 },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      const c = ((await res.json()) as { data: FullCard }).data;
      if (!c) return null;
      const { price, currency } = pickPrice(c);
      return {
        variants: pokemonVariants(c),
        id: c.id,
        name: c.name,
        number: c.number ?? "",
        rarity: c.rarity,
        image: c.images?.small,
        largeImage: c.images?.large ?? c.images?.small,
        setId: c.set?.id,
        setName: c.set?.name,
        series: c.set?.series,
        releaseDate: c.set?.releaseDate ? c.set.releaseDate.replaceAll("/", "-") : "",
        types: c.types,
        hp: c.hp,
        artist: c.artist,
        flavorText: c.flavorText,
        text: (c.attacks ?? []).map((a) =>
          [a.name, a.damage].filter(Boolean).join(" — ") + (a.text ? `: ${a.text}` : ""),
        ),
        price,
        currency,
      };
    } catch {
      return null;
    }
  },

  async getPrintings(name): Promise<GameCard[]> {
    try {
      const q = encodeURIComponent(`name:"${name.replace(/"/g, "")}"`);
      const res = await fetch(
        `${API}/cards?q=${q}&pageSize=250&orderBy=set.releaseDate,number` +
          `&select=id,name,number,rarity,images,set`,
        { headers: headers(), next: { revalidate: 21600 }, signal: AbortSignal.timeout(15000) },
      );
      if (!res.ok) return [];
      const json = (await res.json()) as { data: FullCard[] };
      const want = name.trim().toLowerCase();
      return json.data
        // The API name query is a contains-match; keep only exact-name versions
        // (so "Charizard" doesn't pull in "Charizard ex"/"Charizard VMAX").
        .filter((c) => c.name.trim().toLowerCase() === want)
        .map((c) => ({
          id: c.id,
          name: c.name,
          number: c.number ?? "",
          rarity: c.rarity,
          image: c.images?.small,
          setId: c.set?.id,
          setName: c.set?.name,
          releaseDate: c.set?.releaseDate ? c.set.releaseDate.replaceAll("/", "-") : "",
        }))
        .sort(
          (a, b) =>
            (a.releaseDate ?? "").localeCompare(b.releaseDate ?? "") ||
            compareCardNumber(a.number, b.number),
        );
    } catch {
      return [];
    }
  },

  async searchCards(query, limit = 24): Promise<GameCard[]> {
    const q = query.trim().replace(/"/g, "");
    if (q.length < 2) return [];
    try {
      const enc = encodeURIComponent(`name:"${q}*"`);
      const res = await fetch(
        `${API}/cards?q=${enc}&pageSize=${limit}&orderBy=name,set.releaseDate` +
          `&select=id,name,number,rarity,images,set`,
        { headers: headers(), next: { revalidate: 3600 }, signal: AbortSignal.timeout(10000) },
      );
      if (!res.ok) return [];
      const json = (await res.json()) as { data: FullCard[] };
      return json.data.map((c) => ({
        id: c.id,
        name: c.name,
        number: c.number ?? "",
        rarity: c.rarity,
        image: c.images?.small,
        setId: c.set?.id,
        setName: c.set?.name,
        releaseDate: c.set?.releaseDate ? c.set.releaseDate.replaceAll("/", "-") : "",
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
      const json = (await res.json()) as { data: FullCard[] };
      const c = json.data?.[0];
      if (!c) return null;
      const { price, currency } = pickPreferredPrice(pokemonPrices(c));
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

  // --- Bulk catalogue sync ---

  async fetchAllSets(): Promise<CatalogSetInput[]> {
    const out: CatalogSetInput[] = [];
    for (let page = 1; page < 50; page++) {
      const res = await fetchRetry(
        `${API}/sets?page=${page}&pageSize=250&orderBy=releaseDate` +
          `&select=id,name,series,total,printedTotal,releaseDate,images`,
      );
      if (!res.ok) break;
      const json = (await res.json()) as { data: ApiSet[] };
      if (!json.data?.length) break;
      for (const s of json.data) {
        const m = mapSet(s);
        out.push({
          id: m.id,
          game: "pokemon",
          name: m.name,
          series: m.series,
          total: m.total,
          releaseDate: m.releaseDate,
          logo: m.logo,
          symbol: m.symbol,
        });
      }
      if (json.data.length < 250) break;
    }
    return out;
  },

  async fetchAllCards(onBatch): Promise<number> {
    let total = 0;
    for (let page = 1; page < 500; page++) {
      const res = await fetchRetry(
        `${API}/cards?page=${page}&pageSize=250&orderBy=set.releaseDate,number` +
          `&select=id,name,number,rarity,supertype,types,hp,artist,flavorText,attacks,images,set,cardmarket,tcgplayer`,
      );
      if (!res.ok) break;
      const json = (await res.json()) as { data: FullCard[] };
      if (!json.data?.length) break;
      const batch = json.data.map(pokemonCardInput);
      await onBatch(batch);
      total += batch.length;
      if (json.data.length < 250) break;
    }
    return total;
  },
};

/**
 * Fetch a catalogue-sync page with retries. The public Pokémon TCG API (no key)
 * is slow and throttles under sustained paging, so a single 30s timeout would
 * abort the whole sync on one slow page. Retry with backoff (60s timeout) and
 * only give up after several attempts.
 */
async function fetchRetry(url: string, attempts = 5): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: headers(),
        cache: "no-store",
        signal: AbortSignal.timeout(60000),
      });
      // 429/5xx are transient (rate limit / upstream hiccup) — back off and retry.
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
        return res;
      }
    } catch (e) {
      lastErr = e; // timeout / network error
    }
    // Exponential backoff: 2s, 4s, 8s, 16s.
    await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
  }
  throw lastErr instanceof Error ? lastErr : new Error("fetch failed");
}

/** EUR (Cardmarket) + USD (TCGplayer) market prices + per-finish variants. */
function pokemonPrices(c: FullCard): CardPrice {
  const cm = c.cardmarket?.prices;
  const eur =
    typeof cm?.trendPrice === "number" && cm.trendPrice > 0
      ? cm.trendPrice
      : typeof cm?.averageSellPrice === "number" && cm.averageSellPrice > 0
        ? cm.averageSellPrice
        : undefined;
  const usdMarkets = Object.values(c.tcgplayer?.prices ?? {})
    .map((p) => p?.market)
    .filter((n): n is number => typeof n === "number" && n > 0);
  const usd = usdMarkets.length > 0 ? Math.max(...usdMarkets) : undefined;
  return { eur, usd, variants: pokemonVariants(c) };
}

/** Map a full API card to a catalogue row (static fields + price). */
function pokemonCardInput(c: FullCard): CatalogCardInput {
  return {
    id: c.id,
    game: "pokemon",
    name: c.name,
    setId: c.set?.id ?? "",
    setName: c.set?.name ?? "",
    series: c.set?.series,
    number: c.number ?? "",
    rarity: c.rarity,
    supertype: c.supertype,
    types: c.types ?? [],
    hp: c.hp,
    artist: c.artist,
    flavorText: c.flavorText,
    text: (c.attacks ?? []).map((a) =>
      [a.name, a.damage].filter(Boolean).join(" — ") + (a.text ? `: ${a.text}` : ""),
    ),
    imageSmall: c.images?.small,
    imageLarge: c.images?.large ?? c.images?.small,
    releaseDate: c.set?.releaseDate ? c.set.releaseDate.replaceAll("/", "-") : "",
    price: pokemonPrices(c),
  };
}

type FullCard = {
  id: string;
  name: string;
  number?: string;
  rarity?: string;
  supertype?: string;
  hp?: string;
  types?: string[];
  artist?: string;
  flavorText?: string;
  attacks?: { name: string; text?: string; damage?: string }[];
  images?: { small?: string; large?: string };
  set?: { id?: string; name?: string; series?: string; releaseDate?: string };
  tcgplayer?: { prices?: Record<string, { market?: number } | null> };
  cardmarket?: { prices?: { trendPrice?: number; averageSellPrice?: number } };
};

// Human labels for TCGplayer per-finish price keys (the print variants of one
// physical card: holo, reverse holo, 1st edition, …).
const FINISH_LABELS: Record<string, string> = {
  normal: "Normal",
  holofoil: "Holofoil",
  reverseHolofoil: "Reverse Holofoil",
  "1stEditionNormal": "1st Edition",
  "1stEditionHolofoil": "1st Edition Holofoil",
  unlimited: "Unlimited",
  unlimitedHolofoil: "Unlimited Holofoil",
};
const FINISH_ORDER = Object.keys(FINISH_LABELS);

/** Print finishes of this exact card, from TCGplayer per-finish market prices (USD). */
function pokemonVariants(c: FullCard): { name: string; price?: number; currency?: string }[] {
  const prices = c.tcgplayer?.prices ?? {};
  const entries = Object.entries(prices).filter(([, v]) => v);
  if (entries.length === 0) return [];
  return entries
    .map(([k, v]) => ({
      key: k,
      name: FINISH_LABELS[k] ?? k.replace(/([A-Z])/g, " $1").replace(/^./, (m) => m.toUpperCase()),
      price: typeof v?.market === "number" && v.market > 0 ? v.market : undefined,
      currency: "USD" as const,
    }))
    .sort((a, b) => {
      const ia = FINISH_ORDER.indexOf(a.key);
      const ib = FINISH_ORDER.indexOf(b.key);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    })
    .map(({ name, price, currency }) => ({ name, price, currency }));
}

/** Pick a market price in the preferred currency (EUR by default), falling back. */
function pickPrice(c: FullCard): { price?: number; currency?: string } {
  return pickPreferredPrice(pokemonPrices(c));
}
