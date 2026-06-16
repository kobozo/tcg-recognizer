export type GameId = "pokemon" | "magic";

export type GameMeta = {
  id: GameId;
  name: string; // e.g. "Pokémon"
  full: string; // e.g. "Pokémon Trading Card Game"
  /** Tailwind classes for the game's accent chip (bg + text). */
  accent: string;
  available: boolean;
};

export type GameSet = {
  id: string; // provider set id/code used in routes & card queries
  name: string;
  series: string; // series / set-type
  total: number;
  releaseDate: string; // YYYY-MM-DD or ""
  logo?: string;
  symbol?: string;
};

export type GameCard = {
  id: string;
  name: string;
  number: string;
  rarity?: string;
  image?: string;
  setId?: string;
  setName?: string;
  releaseDate?: string; // YYYY-MM-DD or "" — used to order printings
};

/** A single card with full detail for the card page. */
export type GameCardDetail = GameCard & {
  series?: string;
  types?: string[];
  hp?: string;
  artist?: string;
  flavorText?: string;
  /** Descriptive lines (attacks for Pokémon, oracle text for Magic). */
  text?: string[];
  largeImage?: string;
  price?: number;
  currency?: string;
  /**
   * Print finishes/variants of THIS exact card (same set + number) — e.g.
   * Normal, Holofoil, Reverse Holofoil, 1st Edition — with their market price.
   * Derived from the card's own per-finish pricing (not separate card objects).
   */
  variants?: { name: string; price?: number; currency?: string }[];
};

/** Per-finish price variant for a card (Holofoil, Foil, Etched, …). */
export type PriceVariant = { name: string; price?: number; currency?: string };

/** Market data for a card — the only part that changes; refreshed daily. */
export type CardPrice = {
  eur?: number;
  usd?: number;
  variants?: PriceVariant[];
};

/** A set row destined for the local catalogue mirror. */
export type CatalogSetInput = {
  id: string;
  game: GameId;
  name: string;
  series?: string;
  total: number;
  releaseDate?: string;
  logo?: string;
  symbol?: string;
};

/** A card row destined for the local catalogue mirror (static fields + price). */
export type CatalogCardInput = {
  id: string;
  game: GameId;
  name: string;
  setId: string;
  setName: string;
  series?: string;
  number: string;
  rarity?: string;
  supertype?: string;
  types: string[];
  hp?: string;
  artist?: string;
  flavorText?: string;
  text: string[];
  imageSmall?: string;
  imageLarge?: string;
  releaseDate?: string;
  price: CardPrice;
};

export interface GameProvider {
  listSets(): Promise<GameSet[]>;
  getSet(id: string): Promise<GameSet | null>;
  getSetCards(setId: string): Promise<GameCard[]>;
  /** A single card with full detail. null on miss/error. */
  getCard(id: string): Promise<GameCardDetail | null>;
  /** All printings/versions sharing this card's name, oldest first. */
  getPrintings(name: string): Promise<GameCard[]>;
  /** Search cards by (partial) name for the correction picker; each carries its
   *  set + number so a correction identifies an exact card. */
  searchCards(query: string, limit?: number): Promise<GameCard[]>;
  /** Look up a card by name for metadata + market value. null on miss/error. */
  enrich(name: string): Promise<import("@/lib/types").Enrichment | null>;

  // --- Bulk catalogue sync (optional) ---
  // These hit the API directly and feed the local mirror (lib/games/sync.ts).
  // They are the ONLY read paths that should reach the network in normal
  // operation; everything else is served from the catalogue.
  /** Every set, for the local mirror. */
  fetchAllSets?(): Promise<CatalogSetInput[]>;
  /** Every card, streamed in batches to keep memory bounded. Returns the count. */
  fetchAllCards?(onBatch: (cards: CatalogCardInput[]) => Promise<void>): Promise<number>;
}

/**
 * Pick a market price in the preferred currency (EUR by default), falling back
 * to the other. Shared by the providers and the catalogue read layer so the
 * displayed price is consistent everywhere.
 */
export function pickPreferredPrice(price: {
  eur?: number;
  usd?: number;
}): { price?: number; currency?: string } {
  const { eur, usd } = price;
  if (preferredCurrency() === "EUR") {
    if (eur !== undefined) return { price: eur, currency: "EUR" };
    if (usd !== undefined) return { price: usd, currency: "USD" };
  } else {
    if (usd !== undefined) return { price: usd, currency: "USD" };
    if (eur !== undefined) return { price: eur, currency: "EUR" };
  }
  return {};
}

/**
 * Natural comparison of TCG card numbers so "2" sorts before "10" (the source
 * APIs sort the number field lexicographically). Splits each number into
 * digit/non-digit runs and compares run-by-run; numeric runs compare
 * numerically, so "SH1" < "SH10" and plain "1".."N" precede lettered subsets
 * (TG/GG/SV/promos).
 */
export function compareCardNumber(a: string, b: string): number {
  const re = /(\d+|\D+)/g;
  const pa = (a || "").match(re) ?? [];
  const pb = (b || "").match(re) ?? [];
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (/^\d/.test(x) && /^\d/.test(y)) {
      const d = parseInt(x, 10) - parseInt(y, 10);
      if (d !== 0) return d;
    } else {
      const d = x.localeCompare(y);
      if (d !== 0) return d;
    }
  }
  return 0;
}

/** Normalize a set name for loose matching against model predictions. */
export function normalizeSetName(value: string): string {
  return value.toLowerCase().replace(/\bset\b/g, "").replace(/[^a-z0-9]/g, "").trim();
}

/**
 * Preferred pricing currency for this deployment. We're based in Belgium, so the
 * default is EUR (Cardmarket for Pokémon, Scryfall `eur` for Magic), falling
 * back to USD only when no local price exists. Override with PREFERRED_CURRENCY.
 */
export function preferredCurrency(): string {
  return (process.env.PREFERRED_CURRENCY ?? "EUR").toUpperCase();
}
