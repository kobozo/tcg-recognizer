// Pure mappers from local catalogue rows to the game-domain shapes. Kept free of
// any DB import so they can be unit-tested in isolation.
import type { CatalogCard, CatalogSet } from "@prisma/client";
import type { Enrichment } from "@/lib/types";
import type { GameCard, GameCardDetail, GameSet, PriceVariant } from "./types";
import { pickPreferredPrice } from "./types";

/** Resolve the displayed price/currency for a catalogue row (EUR preferred). */
export function rowPrice(row: CatalogCard): { price?: number; currency?: string } {
  return pickPreferredPrice({
    eur: row.priceEur ?? undefined,
    usd: row.priceUsd ?? undefined,
  });
}

/** Per-finish variants stored as JSON; tolerant of nulls/legacy shapes. */
export function rowVariants(row: CatalogCard): PriceVariant[] {
  const v = row.variants as unknown;
  if (!Array.isArray(v)) return [];
  const out: PriceVariant[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const x = item as Record<string, unknown>;
    const name = typeof x.name === "string" ? x.name : "";
    if (!name) continue;
    out.push({
      name,
      price: typeof x.price === "number" ? x.price : undefined,
      currency: typeof x.currency === "string" ? x.currency : undefined,
    });
  }
  return out;
}

export function rowToSet(row: CatalogSet): GameSet {
  return {
    id: row.id,
    name: row.name,
    series: row.series ?? "",
    total: row.total,
    releaseDate: row.releaseDate ?? "",
    logo: row.logo ?? undefined,
    symbol: row.symbol ?? undefined,
  };
}

export function rowToCard(row: CatalogCard): GameCard {
  return {
    id: row.id,
    name: row.name,
    number: row.number,
    rarity: row.rarity ?? undefined,
    image: row.imageSmall ?? undefined,
    setId: row.setId,
    setName: row.setName,
    releaseDate: row.releaseDate ?? "",
  };
}

export function rowToCardDetail(row: CatalogCard): GameCardDetail {
  const { price, currency } = rowPrice(row);
  return {
    id: row.id,
    name: row.name,
    number: row.number,
    rarity: row.rarity ?? undefined,
    image: row.imageSmall ?? undefined,
    largeImage: row.imageLarge ?? row.imageSmall ?? undefined,
    setId: row.setId,
    setName: row.setName,
    series: row.series ?? undefined,
    releaseDate: row.releaseDate ?? "",
    types: row.types.length ? row.types : undefined,
    hp: row.hp ?? undefined,
    artist: row.artist ?? undefined,
    flavorText: row.flavorText ?? undefined,
    text: row.text.length ? row.text : undefined,
    price,
    currency,
    variants: rowVariants(row),
  };
}

export function rowToEnrichment(row: CatalogCard): Enrichment {
  const { price, currency } = rowPrice(row);
  return {
    hp: row.hp ?? undefined,
    attacks: row.text.length ? row.text : undefined,
    price,
    currency,
    imageUrl: row.imageLarge ?? row.imageSmall ?? undefined,
  };
}
