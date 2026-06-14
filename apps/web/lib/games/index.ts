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

/**
 * Which games are switched on for this deployment. Pokémon is the concentration
 * by default; enable more without code changes via ENABLED_GAMES, e.g.
 * `ENABLED_GAMES=pokemon,magic`. The full multi-TCG architecture stays in place
 * regardless — this only controls what the UI exposes.
 */
export function enabledGameIds(): GameId[] {
  const raw = process.env.ENABLED_GAMES ?? DEFAULT_GAME;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(isGameId);
  return ids.length > 0 ? ids : [DEFAULT_GAME];
}

export function isGameEnabled(id: string): boolean {
  return isGameId(id) && enabledGameIds().includes(id);
}

export function getGameMeta(id: string): GameMeta | null {
  if (!isGameId(id)) return null;
  return { ...GAMES[id].meta, available: isGameEnabled(id) };
}

export function getProvider(id: string): GameProvider | null {
  return isGameId(id) ? GAMES[id].provider : null;
}

/** All known games, with `available` reflecting the ENABLED_GAMES flag. */
export function listGames(): GameMeta[] {
  const enabled = enabledGameIds();
  return Object.values(GAMES).map((g) => ({ ...g.meta, available: enabled.includes(g.meta.id) }));
}

/** Only the games switched on for this deployment. */
export function listEnabledGames(): GameMeta[] {
  return listGames().filter((g) => g.available);
}
