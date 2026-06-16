import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isGameId } from "@/lib/games";
import { syncCatalog, syncPrices } from "@/lib/games/sync";

// Catalogue sync is long-running (a full Pokémon sync pulls ~20k cards), so keep
// it on the Node runtime and out of any caching.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

/** Cron (Authorization: Bearer $CATALOG_SYNC_SECRET) or an admin session. */
async function authorize(req: Request): Promise<boolean> {
  const secret = process.env.CATALOG_SYNC_SECRET;
  if (secret) {
    const header = req.headers.get("authorization");
    if (header === `Bearer ${secret}`) return true;
  }
  const s = await auth();
  return s?.user.role === "ADMIN";
}

/**
 * Trigger a catalogue sync.
 *   POST /api/catalog/sync   body: { mode?: "full" | "prices", game?: string }
 * - "full"   mirrors sets + every card (static fields + current price).
 * - "prices" (default) refreshes only the market data — for the daily cron.
 */
export async function POST(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { mode?: string; game?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // Empty body is fine — fall back to defaults.
  }

  const mode = body.mode === "full" ? "full" : "prices";
  const game = body.game ?? "pokemon";
  if (!isGameId(game)) {
    return NextResponse.json({ error: `Unknown game "${game}"` }, { status: 400 });
  }

  try {
    const result = mode === "full" ? await syncCatalog(game) : await syncPrices(game);
    return NextResponse.json({ ok: true, mode, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "sync failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
