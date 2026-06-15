import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, Layers } from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getProvider, getGameMeta, normalizeSetName } from "@/lib/games";
import { formatMoney } from "@/lib/format";
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
  const card = provider ? await provider.getCard(id) : null;
  return { title: `${card?.name ?? "Card"} · TCG Recognizer` };
}

export default async function CardDetailPage({
  params,
}: {
  params: Promise<{ game: string; id: string }>;
}) {
  const { game, id } = await params;
  const meta = getGameMeta(game);
  const provider = getProvider(game);
  if (!meta || !provider || !meta.available) notFound();

  const card = await provider.getCard(id);
  if (!card) notFound();

  // All printings/versions of this card name (oldest first), best-effort.
  const versions = await provider.getPrintings(card.name).catch(() => []);

  // Mark which versions the user owns — keyed by name + normalized set name.
  const owned = new Set<string>();
  const session = await auth();
  if (session?.user) {
    const rows = await db.scan.findMany({ where: { userId: session.user.id, game } });
    for (const row of rows) {
      const p = row.predictions as unknown as CardPredictions;
      const nm = p?.name?.value;
      const st = p?.set?.value;
      if (nm) owned.add(`${nm.toLowerCase()}|${st ? normalizeSetName(st) : ""}`);
    }
  }
  const ownsKey = (name: string, setName?: string) =>
    owned.has(`${name.toLowerCase()}|${setName ? normalizeSetName(setName) : ""}`);
  const ownsThis = ownsKey(card.name, card.setName);

  return (
    <Container className="py-10 sm:py-14">
      <div className="animate-fade-up">
        <Link
          href={card.setId ? `/sets/${game}/${card.setId}` : `/sets/${game}`}
          className="mb-6 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> {card.setName ?? `${meta.name} sets`}
        </Link>

        {/* Detail */}
        <div className="grid gap-6 sm:grid-cols-[minmax(0,320px)_1fr]">
          <div className="overflow-hidden rounded-2xl border border-border bg-black/30">
            {(card.largeImage || card.image) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={card.largeImage || card.image}
                alt={card.name}
                className="aspect-[3/4] w-full object-contain"
              />
            )}
          </div>

          <div>
            <span className={`mb-2 inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.accent}`}>
              {meta.name}
            </span>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{card.name}</h1>
            <p className="mt-1 text-sm text-muted">
              {card.setName ?? "Unknown set"}
              {card.number ? ` · #${card.number}` : ""}
              {card.releaseDate ? ` · ${card.releaseDate.slice(0, 4)}` : ""}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {ownsThis && (
                <Badge tone="success">
                  <Check className="h-3.5 w-3.5" aria-hidden /> In your collection
                </Badge>
              )}
              {card.rarity && <Badge tone="neutral">{card.rarity}</Badge>}
              {(card.types ?? []).map((t) => (
                <Badge key={t} tone="neutral">{t}</Badge>
              ))}
              {card.hp && <Badge tone="neutral">HP {card.hp}</Badge>}
              {typeof card.price === "number" && (
                <Badge tone="success">{formatMoney(card.price, card.currency)}</Badge>
              )}
            </div>

            {(card.text?.length ?? 0) > 0 && (
              <div className="mt-5 space-y-2">
                {card.text!.map((line, i) => (
                  <p key={i} className="text-sm text-foreground/90">{line}</p>
                ))}
              </div>
            )}

            {card.flavorText && (
              <p className="mt-4 border-l-2 border-border pl-3 text-sm italic text-muted">
                {card.flavorText}
              </p>
            )}
            {card.artist && (
              <p className="mt-3 text-xs text-muted">Illustrated by {card.artist}</p>
            )}
          </div>
        </div>

        {/* Finishes & variants of THIS card (same set + number) */}
        {(card.variants?.length ?? 0) > 0 && (
          <div className="mt-10">
            <h2 className="mb-3 text-lg font-semibold">Finishes &amp; variants</h2>
            <ul className="flex flex-wrap gap-2">
              {card.variants!.map((v) => (
                <li
                  key={v.name}
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface/60 px-3 py-1.5 text-sm"
                >
                  <span className="font-medium">{v.name}</span>
                  {typeof v.price === "number" && (
                    <span className="text-muted">{formatMoney(v.price, v.currency)}</span>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">
              Print finishes of this exact card · prices from TCGplayer (USD).
            </p>
          </div>
        )}

        {/* All versions */}
        <div className="mt-12">
          <div className="mb-4 flex items-center gap-2">
            <Layers className="h-5 w-5 text-muted" aria-hidden />
            <h2 className="text-lg font-semibold">
              All versions{versions.length > 0 ? ` (${versions.length})` : ""}
            </h2>
          </div>

          {versions.length <= 1 ? (
            <Card className="p-6 text-center text-sm text-muted">
              No other printings of this card were found.
            </Card>
          ) : (
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {versions.map((v) => {
                const isThis = v.id === card.id;
                const has = ownsKey(v.name, v.setName);
                return (
                  <li key={v.id}>
                    <Link href={`/cards/${game}/${v.id}`}>
                      <Card
                        className={`relative overflow-hidden p-0 transition-transform hover:-translate-y-0.5 ${
                          isThis ? "ring-2 ring-accent" : has ? "ring-2 ring-primary" : ""
                        }`}
                      >
                        <div className="aspect-[3/4] bg-black/30">
                          {v.image && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={v.image} alt={v.name} className="h-full w-full object-cover" />
                          )}
                        </div>
                        {has && (
                          <span className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-fg shadow">
                            <Check className="h-4 w-4" aria-hidden />
                          </span>
                        )}
                        <div className="p-2">
                          <p className="truncate text-xs font-medium" title={v.setName ?? ""}>
                            {v.setName ?? "—"}
                          </p>
                          <p className="text-[11px] text-muted">
                            #{v.number}
                            {v.releaseDate ? ` · ${v.releaseDate.slice(0, 4)}` : ""}
                          </p>
                        </div>
                      </Card>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Container>
  );
}
