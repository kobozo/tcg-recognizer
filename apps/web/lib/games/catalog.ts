// Catalogue read layer: serve cards/sets from the local mirror (CatalogCard /
// CatalogSet) instead of hitting the game APIs on every request. `withCatalog`
// wraps a live provider so reads consult the DB first and fall back to the API
// only when the catalogue is empty (e.g. before the first sync).
import { db } from "@/lib/db";
import type { Enrichment } from "@/lib/types";
import type { GameCard, GameCardDetail, GameId, GameProvider, GameSet } from "./types";
import { compareCardNumber } from "./types";
import {
  rowToCard,
  rowToCardDetail,
  rowToEnrichment,
  rowToSet,
} from "./catalog-map";

async function catalogSets(game: GameId): Promise<GameSet[]> {
  const rows = await db.catalogSet.findMany({
    where: { game },
    orderBy: { releaseDate: "desc" },
  });
  return rows.map(rowToSet);
}

async function catalogGetSet(game: GameId, id: string): Promise<GameSet | null> {
  const row = await db.catalogSet.findFirst({ where: { game, id } });
  return row ? rowToSet(row) : null;
}

async function catalogGetSetCards(game: GameId, setId: string): Promise<GameCard[]> {
  const rows = await db.catalogCard.findMany({ where: { game, setId } });
  // DB orders the `number` column lexicographically ("10" before "2"); fix it.
  return rows.map(rowToCard).sort((a, b) => compareCardNumber(a.number, b.number));
}

async function catalogGetCard(game: GameId, id: string): Promise<GameCardDetail | null> {
  const row = await db.catalogCard.findFirst({ where: { game, id } });
  return row ? rowToCardDetail(row) : null;
}

async function catalogGetPrintings(game: GameId, name: string): Promise<GameCard[]> {
  const rows = await db.catalogCard.findMany({
    where: { game, name: { equals: name.trim(), mode: "insensitive" } },
  });
  return rows
    .map(rowToCard)
    .sort(
      (a, b) =>
        (a.releaseDate ?? "").localeCompare(b.releaseDate ?? "") ||
        compareCardNumber(a.number, b.number),
    );
}

async function catalogSearchCards(
  game: GameId,
  query: string,
  limit = 24,
): Promise<GameCard[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const rows = await db.catalogCard.findMany({
    where: { game, name: { startsWith: q, mode: "insensitive" } },
    orderBy: [{ name: "asc" }, { releaseDate: "asc" }],
    take: limit,
  });
  return rows.map(rowToCard);
}

async function catalogEnrich(game: GameId, name: string): Promise<Enrichment | null> {
  const row = await db.catalogCard.findFirst({
    where: { game, name: { equals: name.trim(), mode: "insensitive" } },
  });
  return row ? rowToEnrichment(row) : null;
}

/**
 * Wrap a live provider so reads serve from the local catalogue, falling back to
 * the provider's API only when the catalogue has nothing (graceful before the
 * first sync, or for entities not yet mirrored). The bulk-sync methods
 * (fetchAll*) pass through unchanged — the sync jobs use the live API.
 */
export function withCatalog(provider: GameProvider, game: GameId): GameProvider {
  return {
    ...provider,
    async listSets() {
      const rows = await catalogSets(game);
      return rows.length ? rows : provider.listSets();
    },
    async getSet(id) {
      return (await catalogGetSet(game, id)) ?? provider.getSet(id);
    },
    async getSetCards(setId) {
      const rows = await catalogGetSetCards(game, setId);
      return rows.length ? rows : provider.getSetCards(setId);
    },
    async getCard(id) {
      return (await catalogGetCard(game, id)) ?? provider.getCard(id);
    },
    async getPrintings(name) {
      const rows = await catalogGetPrintings(game, name);
      return rows.length ? rows : provider.getPrintings(name);
    },
    async searchCards(query, limit) {
      const rows = await catalogSearchCards(game, query, limit);
      return rows.length ? rows : provider.searchCards(query, limit);
    },
    async enrich(name) {
      return (await catalogEnrich(game, name)) ?? provider.enrich(name);
    },
  };
}
