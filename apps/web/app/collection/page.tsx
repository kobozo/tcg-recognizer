import Link from "next/link";
import path from "node:path";
import { redirect } from "next/navigation";
import { Camera, Layers, Library, Sparkles, Boxes } from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { listSets, normalizeSetName } from "@/lib/pokemon";
import Container from "@/components/ui/Container";
import { Card } from "@/components/ui/Card";
import { buttonVariants } from "@/components/ui/Button";
import CollectionView, { type CollectionCard } from "@/components/CollectionView";
import type { CardPredictions } from "@/lib/types";

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

  const [rows, sets] = await Promise.all([
    db.scan.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
    }),
    listSets(),
  ]);

  const totalsBySet = new Map(sets.map((s) => [normalizeSetName(s.name), s]));

  const cards: CollectionCard[] = rows.map((s) => {
    const p = s.predictions as unknown as CardPredictions;
    return {
      id: s.id,
      name: p?.name?.value ?? "Unknown card",
      set: p?.set?.value ?? "Unknown set",
      rarity: p?.rarity?.value ?? "—",
      date: s.createdAt.toISOString(),
      image: `/api/uploads/${path.basename(s.imagePath)}`,
    };
  });

  // Per-set completion: owned count vs the official set total (when known).
  const ownedBySet = new Map<string, number>();
  for (const c of cards) ownedBySet.set(c.set, (ownedBySet.get(c.set) ?? 0) + 1);

  const setProgress = [...ownedBySet.entries()]
    .map(([name, owned]) => {
      const official = totalsBySet.get(normalizeSetName(name));
      return {
        name,
        owned,
        total: official?.total ?? 0,
        logo: official?.logo,
      };
    })
    .sort((a, b) => b.owned - a.owned);

  const uniqueNames = new Set(cards.map((c) => c.name)).size;
  const distinctSets = ownedBySet.size;
  const distinctRarities = new Set(cards.map((c) => c.rarity)).size;

  if (cards.length === 0) {
    return (
      <Container className="py-16">
        <Card className="mx-auto max-w-lg p-10 text-center">
          <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-primary to-accent text-white shadow-glow">
            <Boxes className="h-7 w-7" aria-hidden />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">Start your collection</h1>
          <p className="mx-auto mt-2 max-w-sm text-muted">
            Scan a Pokémon card with your camera and it lands here. Build sets, track rarities
            and watch your collection grow.
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
        {/* Header */}
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

        {/* Stats */}
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard icon={Layers} label="Cards" value={cards.length} />
          <StatCard icon={Sparkles} label="Unique" value={uniqueNames} />
          <StatCard icon={Boxes} label="Sets" value={distinctSets} />
          <StatCard icon={Library} label="Rarities" value={distinctRarities} />
        </div>

        {/* Set completion */}
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">Set completion</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {setProgress.map((sp) => {
              const pct = sp.total > 0 ? Math.min(100, Math.round((sp.owned / sp.total) * 100)) : 0;
              return (
                <Card key={sp.name} className="p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="truncate font-medium">{sp.name}</span>
                    <span className="shrink-0 text-sm text-muted">
                      {sp.owned}
                      {sp.total > 0 ? ` / ${sp.total}` : ""}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary to-accent"
                      style={{ width: sp.total > 0 ? `${pct}%` : "100%" }}
                    />
                  </div>
                  {sp.total > 0 && (
                    <p className="mt-1 text-xs text-muted">{pct}% complete</p>
                  )}
                </Card>
              );
            })}
          </div>
        </section>

        {/* Cards */}
        <CollectionView cards={cards} />
      </div>
    </Container>
  );
}
