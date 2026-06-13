// Free Pokémon TCG API (https://docs.pokemontcg.io) — no key required for
// modest use; set POKEMON_TCG_API_KEY for higher rate limits. We already use
// this source for card enrichment, so sets/collections come from the same place.

const API = "https://api.pokemontcg.io/v2";

export type PokemonSet = {
  id: string;
  name: string;
  series: string;
  total: number;
  releaseDate: string;
  logo?: string;
  symbol?: string;
};

type ApiSet = {
  id: string;
  name: string;
  series: string;
  total?: number;
  printedTotal?: number;
  releaseDate?: string;
  images?: { logo?: string; symbol?: string };
};

function headers(): HeadersInit {
  const key = process.env.POKEMON_TCG_API_KEY;
  return key ? { "X-Api-Key": key } : {};
}

/**
 * List all official Pokémon TCG sets, newest first. Cached for a day (sets
 * change rarely). Returns [] on any error so callers never break.
 */
export async function listSets(): Promise<PokemonSet[]> {
  try {
    const res = await fetch(
      `${API}/sets?orderBy=-releaseDate&select=id,name,series,total,releaseDate,images`,
      { headers: headers(), next: { revalidate: 86400 }, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { data: ApiSet[] };
    return json.data.map((s) => ({
      id: s.id,
      name: s.name,
      series: s.series,
      total: s.total ?? s.printedTotal ?? 0,
      releaseDate: s.releaseDate ?? "",
      logo: s.images?.logo,
      symbol: s.images?.symbol,
    }));
  } catch {
    return [];
  }
}

/** Normalize a set name for loose matching against model predictions. */
export function normalizeSetName(value: string): string {
  return value.toLowerCase().replace(/\bset\b/g, "").replace(/[^a-z0-9]/g, "").trim();
}
