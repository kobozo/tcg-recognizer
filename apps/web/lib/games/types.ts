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
};

export interface GameProvider {
  listSets(): Promise<GameSet[]>;
  getSet(id: string): Promise<GameSet | null>;
  getSetCards(setId: string): Promise<GameCard[]>;
}

/** Normalize a set name for loose matching against model predictions. */
export function normalizeSetName(value: string): string {
  return value.toLowerCase().replace(/\bset\b/g, "").replace(/[^a-z0-9]/g, "").trim();
}
