import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getProvider, getGameMeta, normalizeSetName } from "@/lib/games";
import Container from "@/components/ui/Container";
import { Card } from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import GameTabs from "@/components/GameTabs";
import type { CardPredictions } from "@/lib/types";

export const revalidate = 86400;

export async function generateMetadata({ params }: { params: Promise<{ game: string }> }) {
  const { game } = await params;
  const meta = getGameMeta(game);
  return { title: `${meta?.name ?? "Sets"} sets · TCG Recognizer` };
}

export default async function GameSetsPage({
  params,
}: {
  params: Promise<{ game: string }>;
}) {
  const { game } = await params;
  const meta = getGameMeta(game);
  const provider = getProvider(game);
  if (!meta || !provider) notFound();

  const sets = await provider.listSets();

  // Per-set owned counts for the signed-in user, scoped to this game.
  const owned = new Map<string, number>();
  const session = await auth();
  if (session?.user) {
    const rows = await db.scan.findMany({ where: { userId: session.user.id, game } });
    for (const row of rows) {
      const value = (row.predictions as unknown as CardPredictions)?.set?.value;
      if (value) {
        const key = normalizeSetName(value);
        owned.set(key, (owned.get(key) ?? 0) + 1);
      }
    }
  }

  return (
    <Container className="py-10 sm:py-14">
      <div className="animate-fade-up">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {meta.name} sets{sets.length > 0 ? ` · ${sets.length}` : ""}
          </h1>
        </div>
        <div className="mb-6">
          <GameTabs basePath="/sets" current={game} />
        </div>

        {sets.length === 0 ? (
          <Card className="flex items-center gap-3 p-6 text-sm text-muted">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" aria-hidden />
            Couldn&apos;t reach the {meta.name} API right now. Try again shortly.
          </Card>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sets.map((set) => {
              const ownedCount = owned.get(normalizeSetName(set.name)) ?? 0;
              return (
                <li key={set.id}>
                  <Link href={`/sets/${game}/${set.id}`} className="block h-full">
                    <Card className="flex h-full flex-col gap-3 p-5 transition-colors hover:border-white/20 hover:bg-elevated">
                      <div className="flex h-16 items-center">
                        {set.logo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={set.logo}
                            alt={`${set.name} logo`}
                            className="max-h-14 max-w-[60%] object-contain"
                          />
                        ) : (
                          <span className="text-lg font-semibold">{set.name}</span>
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-foreground">{set.name}</p>
                        <p className="text-sm text-muted">
                          {set.series}
                          {set.releaseDate ? ` · ${set.releaseDate.slice(0, 4)}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center justify-between">
                        <Badge tone="neutral">{set.total} cards</Badge>
                        {session?.user && (
                          <Badge tone={ownedCount > 0 ? "success" : "neutral"}>
                            {ownedCount > 0 ? `${ownedCount} owned` : "0 owned"}
                          </Badge>
                        )}
                      </div>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Container>
  );
}
