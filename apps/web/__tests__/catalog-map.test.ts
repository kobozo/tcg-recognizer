import { describe, it, expect } from "vitest";
import type { CatalogCard, CatalogSet } from "@prisma/client";
import {
  rowPrice,
  rowVariants,
  rowToCard,
  rowToCardDetail,
  rowToEnrichment,
  rowToSet,
} from "@/lib/games/catalog-map";

function makeCard(overrides: Partial<CatalogCard> = {}): CatalogCard {
  return {
    id: "dp3-3",
    game: "pokemon",
    name: "Charizard",
    setId: "dp3",
    setName: "Secret Wonders",
    series: "Diamond & Pearl",
    number: "3",
    rarity: "Rare Holo",
    supertype: "Pokémon",
    types: ["Fire"],
    hp: "130",
    artist: "Kagemaru Himeno",
    flavorText: null,
    text: ["Blast Burn — 120"],
    imageSmall: "https://img/small.png",
    imageLarge: "https://img/large.png",
    releaseDate: "2007-11-01",
    priceEur: 70.53,
    priceUsd: 694.87,
    variants: [{ name: "Holofoil", price: 694.87, currency: "USD" }],
    priceUpdatedAt: new Date("2026-06-16T00:00:00Z"),
    syncedAt: new Date("2026-06-16T00:00:00Z"),
    ...overrides,
  } as CatalogCard;
}

function makeSet(overrides: Partial<CatalogSet> = {}): CatalogSet {
  return {
    id: "dp3",
    game: "pokemon",
    name: "Secret Wonders",
    series: "Diamond & Pearl",
    total: 132,
    releaseDate: "2007-11-01",
    logo: "https://img/logo.png",
    symbol: "https://img/symbol.png",
    syncedAt: new Date("2026-06-16T00:00:00Z"),
    ...overrides,
  } as CatalogSet;
}

describe("rowPrice", () => {
  it("prefers EUR by default", () => {
    expect(rowPrice(makeCard())).toEqual({ price: 70.53, currency: "EUR" });
  });

  it("falls back to USD when EUR is missing", () => {
    expect(rowPrice(makeCard({ priceEur: null }))).toEqual({
      price: 694.87,
      currency: "USD",
    });
  });

  it("returns empty when no price is known", () => {
    expect(rowPrice(makeCard({ priceEur: null, priceUsd: null }))).toEqual({});
  });
});

describe("rowVariants", () => {
  it("parses stored variant JSON", () => {
    expect(rowVariants(makeCard())).toEqual([
      { name: "Holofoil", price: 694.87, currency: "USD" },
    ]);
  });

  it("tolerates null / non-array variants", () => {
    expect(rowVariants(makeCard({ variants: null }))).toEqual([]);
    expect(rowVariants(makeCard({ variants: "oops" as never }))).toEqual([]);
  });
});

describe("rowToCardDetail", () => {
  it("maps static fields and the preferred price", () => {
    const d = rowToCardDetail(makeCard());
    expect(d).toMatchObject({
      id: "dp3-3",
      name: "Charizard",
      hp: "130",
      setName: "Secret Wonders",
      largeImage: "https://img/large.png",
      price: 70.53,
      currency: "EUR",
      types: ["Fire"],
      text: ["Blast Burn — 120"],
    });
    expect(d.variants).toHaveLength(1);
  });

  it("omits empty array fields", () => {
    const d = rowToCardDetail(makeCard({ types: [], text: [] }));
    expect(d.types).toBeUndefined();
    expect(d.text).toBeUndefined();
  });
});

describe("rowToCard", () => {
  it("maps the list shape", () => {
    expect(rowToCard(makeCard())).toEqual({
      id: "dp3-3",
      name: "Charizard",
      number: "3",
      rarity: "Rare Holo",
      image: "https://img/small.png",
      setId: "dp3",
      setName: "Secret Wonders",
      releaseDate: "2007-11-01",
    });
  });
});

describe("rowToEnrichment", () => {
  it("maps hp, attacks, price and image", () => {
    expect(rowToEnrichment(makeCard())).toEqual({
      hp: "130",
      attacks: ["Blast Burn — 120"],
      price: 70.53,
      currency: "EUR",
      imageUrl: "https://img/large.png",
    });
  });
});

describe("rowToSet", () => {
  it("maps set fields", () => {
    expect(rowToSet(makeSet())).toEqual({
      id: "dp3",
      name: "Secret Wonders",
      series: "Diamond & Pearl",
      total: 132,
      releaseDate: "2007-11-01",
      logo: "https://img/logo.png",
      symbol: "https://img/symbol.png",
    });
  });
});
