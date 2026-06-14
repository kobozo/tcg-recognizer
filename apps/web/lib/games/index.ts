import type { GameId, GameMeta, GameProvider } from "./types";
import { pokemonProvider } from "./pokemon";
import { magicProvider } from "./magic";

export * from "./types";

type GameEntry = { meta: GameMeta; provider: GameProvider };

export const GAMES: Record<GameId, GameEntry> = {
  pokemon: {
    meta: {
      id: "pokemon",
      name: "Pokémon",
      full: "Pokémon Trading Card Game",
      accent: "bg-amber-400/15 text-amber-300",
      available: true,
    },
    provider: pokemonProvider,
  },
  magic: {
    meta: {
      id: "magic",
      name: "Magic",
      full: "Magic: The Gathering",
      accent: "bg-orange-500/15 text-orange-300",
      available: true,
    },
    provider: magicProvider,
  },
};

export const DEFAULT_GAME: GameId = "pokemon";

export function isGameId(value: string): value is GameId {
  return value === "pokemon" || value === "magic";
}

export function getGameMeta(id: string): GameMeta | null {
  return isGameId(id) ? GAMES[id].meta : null;
}

export function getProvider(id: string): GameProvider | null {
  return isGameId(id) ? GAMES[id].provider : null;
}

export function listGames(): GameMeta[] {
  return Object.values(GAMES).map((g) => g.meta);
}
