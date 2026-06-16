// Catalogue sync jobs. The full sync mirrors the (mostly static) card + set
// catalogue into the DB; the price sync refreshes only the market data. The
// game APIs are hit ONLY here — every request-path read serves from the mirror.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getProviderRaw } from "./index";
import type { CatalogCardInput, CatalogSetInput, GameId } from "./types";

export type SyncResult = { game: GameId; sets: number; cards: number };

/** Price columns derived from a freshly-fetched card. */
function priceData(c: CatalogCardInput) {
  return {
    priceEur: c.price.eur ?? null,
    priceUsd: c.price.usd ?? null,
    variants: (c.price.variants ?? []) as unknown as Prisma.InputJsonValue,
    priceUpdatedAt: new Date(),
  };
}

/** Full row (static fields + price) for a create/update. */
function cardData(c: CatalogCardInput) {
  return {
    game: c.game,
    name: c.name,
    setId: c.setId,
    setName: c.setName,
    series: c.series ?? null,
    number: c.number,
    rarity: c.rarity ?? null,
    supertype: c.supertype ?? null,
    types: c.types,
    hp: c.hp ?? null,
    artist: c.artist ?? null,
    flavorText: c.flavorText ?? null,
    text: c.text,
    imageSmall: c.imageSmall ?? null,
    imageLarge: c.imageLarge ?? null,
    releaseDate: c.releaseDate ?? null,
    ...priceData(c),
  };
}

async function writeCards(batch: CatalogCardInput[], pricesOnly: boolean): Promise<void> {
  if (pricesOnly) {
    // Touch only the market columns; static fields are left as-is. updateMany
    // no-ops for cards not yet mirrored (a full sync will add them).
    await db.$transaction(
      batch.map((c) =>
        db.catalogCard.updateMany({ where: { id: c.id, game: c.game }, data: priceData(c) }),
      ),
    );
    return;
  }
  await db.$transaction(
    batch.map((c) =>
      db.catalogCard.upsert({
        where: { id: c.id },
        create: { id: c.id, ...cardData(c) },
        update: cardData(c),
      }),
    ),
  );
}

async function writeSets(sets: CatalogSetInput[]): Promise<void> {
  for (let i = 0; i < sets.length; i += 100) {
    const batch = sets.slice(i, i + 100);
    await db.$transaction(
      batch.map((s) => {
        const data = {
          game: s.game,
          name: s.name,
          series: s.series ?? null,
          total: s.total,
          releaseDate: s.releaseDate ?? null,
          logo: s.logo ?? null,
          symbol: s.symbol ?? null,
        };
        return db.catalogSet.upsert({
          where: { id: s.id },
          create: { id: s.id, ...data },
          update: data,
        });
      }),
    );
  }
}

/**
 * Mirror the full catalogue (sets + every card, static fields + current price)
 * for a game into the DB. Idempotent — safe to re-run; existing rows are updated.
 */
export async function syncCatalog(game: GameId): Promise<SyncResult> {
  const provider = getProviderRaw(game);
  if (!provider?.fetchAllSets || !provider.fetchAllCards) {
    throw new Error(`Provider "${game}" does not support catalogue sync`);
  }
  const sets = await provider.fetchAllSets();
  await writeSets(sets);
  const cards = await provider.fetchAllCards((batch) => writeCards(batch, false));
  return { game, sets: sets.length, cards };
}

/**
 * Refresh only the market data (EUR/USD price + per-finish variants) for every
 * mirrored card. Intended to run on a daily schedule.
 */
export async function syncPrices(game: GameId): Promise<SyncResult> {
  const provider = getProviderRaw(game);
  if (!provider?.fetchAllCards) {
    throw new Error(`Provider "${game}" does not support price sync`);
  }
  const cards = await provider.fetchAllCards((batch) => writeCards(batch, true));
  return { game, sets: 0, cards };
}
