import Link from "next/link";
import path from "node:path";
import { redirect } from "next/navigation";
import { Camera, Layers, Library, Wallet, Boxes } from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getGameMeta, getProvider, listGames, normalizeSetName } from "@/lib/games";
import Container from "@/components/ui/Container";
import { Card } from "@/components/ui/Card";
import { buttonVariants } from "@/components/ui/Button";
import CollectionView, { type CollectionCard } from "@/components/CollectionView";
import { formatMoney, formatTotals } from "@/lib/format";
import type { CardPredictions, Enrichment } from "@/lib/types";

export const metadata = { title: "My collection · TCG Recognizer" };

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Layers;
  label: string;
  value: string | number;
}) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/5 text-accent">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <div>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      </div>
    </Card>
  );
}

export default async function CollectionPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/collection");

  const rows = await db.scan.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  const gameName = (id: string) => getGameMeta(id)?.name ?? id;

  const cards: CollectionCard[] = rows.map((s) => {
    const stored = s.predictions as unknown as CardPredictions & {
      enrichment?: Enrichment | null;
    };
    return {
      id: s.id,
      name: stored?.name?.value ?? "Unknown card",
      game: gameName(s.game),
      set: stored?.set?.value ?? "Unknown set",
      rarity: stored?.rarity?.value ?? "—",
      date: s.createdAt.toISOString(),
      image: `/api/uploads/${path.basename(s.imagePath)}`,
      price: stored?.enrichment?.price,
      currency: stored?.enrichment?.currency,
    };
  });

  const totalValue = formatTotals(cards);

  // Which games does the user have cards in? Fetch official totals for each.
  const gamesPresent = [...new Set(rows.map((r) => r.game))];
  const totalsByGameSet = new Map<string, number>(); // `${game}:${normName}` -> total
  await Promise.all(
    gamesPresent.map(async (g) => {
      const provider = getProvider(g);
      if (!provider) return;
      const sets = await provider.listSets();
      for (const s of sets) totalsByGameSet.set(`${g}:${normalizeSetName(s.name)}`, s.total);
    }),
  );

  // Per (game, set) completion + value.
  const ownedByGameSet = new Map<
    string,
    { game: string; set: string; owned: number; value: number; currency?: string }
  >();
  for (const r of rows) {
    const stored = r.predictions as unknown as CardPredictions & {
      enrichment?: Enrichment | null;
    };
    const setName = stored?.set?.value || "Unknown set";
    const key = `${r.game}:${setName}`;
    const cur = ownedByGameSet.get(key) ?? { game: r.game, set: setName, owned: 0, value: 0 };
    cur.owned += 1;
    const price = stored?.enrichment?.price;
    if (typeof price === "number" && price > 0) {
      cur.value += price;
      cur.currency = cur.currency ?? stored?.enrichment?.currency;
    }
    ownedByGameSet.set(key, cur);
  }
  const setProgress = [...ownedByGameSet.values()]
    .map((e) => ({
      ...e,
      gameLabel: gameName(e.game),
      total: totalsByGameSet.get(`${e.game}:${normalizeSetName(e.set)}`) ?? 0,
    }))
    .sort((a, b) => b.value - a.value || b.owned - a.owned);

  const distinctSets = ownedByGameSet.size;
  const distinctGames = gamesPresent.length;

  if (cards.length === 0) {
    return (
      <Container className="py-16">
        <Card className="mx-auto max-w-lg p-10 text-center">
          <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-primary to-accent text-white shadow-glow">
            <Boxes className="h-7 w-7" aria-hidden />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">Start your collection</h1>
          <p className="mx-auto mt-2 max-w-sm text-muted">
            Scan a card with your camera and it lands here. Collect across{" "}
            {listGames().map((g) => g.name).join(", ")} and more.
          </p>
          <Link
            href="/scan"
            className={buttonVariants({ variant: "primary", size: "lg", className: "mt-6" })}
          >
            <Camera className="h-5 w-5" aria-hidden /> Add your first card
          </Link>
        </Card>
      </Container>
    );
  }

  return (
    <Container className="py-10 sm:py-14">
      <div className="animate-fade-up">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">My collection</h1>
            <p className="mt-1 text-sm text-muted">Everything you&apos;ve collected so far</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/sets" className={buttonVariants({ variant: "outline", size: "md" })}>
              <Library className="h-4 w-4" aria-hidden /> Browse sets
            </Link>
            <Link href="/scan" className={buttonVariants({ variant: "primary", size: "md" })}>
              <Camera className="h-4 w-4" aria-hidden /> Add a card
            </Link>
          </div>
        </div>

        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard icon={Wallet} label="Est. value" value={totalValue} />
          <StatCard icon={Layers} label="Cards owned" value={cards.length} />
          <StatCard icon={Boxes} label="Sets" value={distinctSets} />
          <StatCard icon={Library} label="Games" value={distinctGames} />
        </div>

        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">Set completion</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {setProgress.map((sp) => {
              const pct = sp.total > 0 ? Math.min(100, Math.round((sp.owned / sp.total) * 100)) : 0;
              return (
                <Card key={`${sp.game}:${sp.set}`} className="p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="truncate font-medium">
                      <span className="text-muted">{sp.gameLabel} · </span>
                      {sp.set}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-sm">
                      {sp.value > 0 && (
                        <span className="font-semibold text-emerald-300">
                          {formatMoney(sp.value, sp.currency)}
                        </span>
                      )}
                      <span className="text-muted">
                        {sp.owned}
                        {sp.total > 0 ? ` / ${sp.total}` : ""}
                      </span>
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary to-accent"
                      style={{ width: sp.total > 0 ? `${pct}%` : "100%" }}
                    />
                  </div>
                  {sp.total > 0 && <p className="mt-1 text-xs text-muted">{pct}% complete</p>}
                </Card>
              );
            })}
          </div>
        </section>

        <CollectionView cards={cards} />
      </div>
    </Container>
  );
}
