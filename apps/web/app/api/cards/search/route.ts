import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProvider, isGameEnabled } from "@/lib/games";

/**
 * Card search for the scan-correction picker. Returns candidates by (partial)
 * name, each carrying its collection (set) + number, so a correction identifies
 * an exact card rather than just a name.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const gameRaw = url.searchParams.get("game") ?? "pokemon";
  const game = isGameEnabled(gameRaw) ? gameRaw : "pokemon";
  if (q.length < 2) return NextResponse.json({ results: [] });

  const provider = getProvider(game);
  if (!provider) return NextResponse.json({ results: [] });

  const cards = await provider.searchCards(q, 24).catch(() => []);
  return NextResponse.json({
    results: cards.map((c) => ({
      id: c.id,
      name: c.name,
      set: c.setName ?? "",
      setId: c.setId ?? "",
      number: c.number,
      image: c.image,
    })),
  });
}
