import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check } from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getProvider, getGameMeta, normalizeSetName } from "@/lib/games";
import Container from "@/components/ui/Container";
import { Card } from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import type { CardPredictions } from "@/lib/types";

export const revalidate = 86400;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ game: string; id: string }>;
}) {
  const { game, id } = await params;
  const provider = getProvider(game);
  const set = provider ? await provider.getSet(id) : null;
  return { title: `${set?.name ?? "Set"} · TCG Recognizer` };
}

export default async function SetDetailPage({
  params,
}: {
  params: Promise<{ game: string; id: string }>;
}) {
  const { game, id } = await params;
  const meta = getGameMeta(game);
  const provider = getProvider(game);
  if (!meta || !provider) notFound();

  const [set, cards] = await Promise.all([provider.getSet(id), provider.getSetCards(id)]);
  if (!set) notFound();

  const ownedNames = new Set<string>();
  const session = await auth();
  if (session?.user) {
    const rows = await db.scan.findMany({ where: { userId: session.user.id, game } });
    for (const row of rows) {
      const p = row.predictions as unknown as CardPredictions;
      if (p?.set?.value && normalizeSetName(p.set.value) === normalizeSetName(set.name)) {
        ownedNames.add((p.name?.value ?? "").toLowerCase());
      }
    }
  }

  const ownedCount = cards.filter((c) => ownedNames.has(c.name.toLowerCase())).length;
  const pct = cards.length > 0 ? Math.round((ownedCount / cards.length) * 100) : 0;

  return (
    <Container className="py-10 sm:py-14">
      <div className="animate-fade-up">
        <Link
          href={`/sets/${game}`}
          className="mb-6 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> All {meta.name} sets
        </Link>

        <div className="mb-8 flex flex-wrap items-center gap-5">
          {set.logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={set.logo} alt={`${set.name} logo`} className="h-16 w-16 object-contain" />
          )}
          <div className="flex-1">
            <span className={`mb-1 inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.accent}`}>
              {meta.name}
            </span>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{set.name}</h1>
            <p className="text-sm text-muted">
              {set.series}
              {set.releaseDate ? ` · ${set.releaseDate.slice(0, 4)}` : ""} · {set.total} cards
            </p>
          </div>
          {session?.user && (
            <div className="text-right">
              <p className="text-2xl font-semibold">
                {ownedCount}
                <span className="text-muted">/{cards.length || set.total}</span>
              </p>
              <Badge tone={ownedCount > 0 ? "success" : "neutral"}>{pct}% complete</Badge>
            </div>
          )}
        </div>

        {cards.length === 0 ? (
          <Card className="p-8 text-center text-muted">
            Card list for this set isn&apos;t available right now.
          </Card>
        ) : (
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {cards.map((c) => {
              const owned = ownedNames.has(c.name.toLowerCase());
              return (
                <li key={c.id}>
                  <Card
                    className={`relative overflow-hidden p-0 ${owned ? "ring-2 ring-primary" : "opacity-60"}`}
                  >
                    <div className="aspect-[3/4] bg-black/30">
                      {c.image && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={c.image}
                          alt={c.name}
                          className={`h-full w-full object-cover ${owned ? "" : "grayscale"}`}
                        />
                      )}
                    </div>
                    {owned && (
                      <span className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-fg shadow">
                        <Check className="h-4 w-4" aria-hidden />
                      </span>
                    )}
                    <div className="p-2">
                      <p className="truncate text-xs font-medium">{c.name}</p>
                      <p className="text-[11px] text-muted">#{c.number}</p>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Container>
  );
}
