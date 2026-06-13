import Link from "next/link";
import path from "node:path";
import { redirect } from "next/navigation";
import { Camera, Layers, LayoutGrid } from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import Container from "@/components/ui/Container";
import { Card } from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { buttonVariants } from "@/components/ui/Button";
import type { CardPredictions } from "@/lib/types";

export const metadata = { title: "My collection · TCG Recognizer" };

type ScanRow = {
  id: string;
  imagePath: string;
  modelVersion: string;
  createdAt: Date;
  predictions: CardPredictions;
};

export default async function CollectionPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/collection");

  const rows = await db.scan.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  const scans: ScanRow[] = rows.map((s) => ({
    id: s.id,
    imagePath: s.imagePath,
    modelVersion: s.modelVersion,
    createdAt: s.createdAt,
    predictions: s.predictions as unknown as CardPredictions,
  }));

  // Group the collection by the card's set.
  const groups = new Map<string, ScanRow[]>();
  for (const scan of scans) {
    const set = scan.predictions?.set?.value || "Unknown set";
    const list = groups.get(set) ?? [];
    list.push(scan);
    groups.set(set, list);
  }

  return (
    <Container className="py-10 sm:py-14">
      <div className="animate-fade-up">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">My collection</h1>
            <p className="mt-1 text-sm text-muted">
              {scans.length} card{scans.length === 1 ? "" : "s"} across {groups.size} set
              {groups.size === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/sets" className={buttonVariants({ variant: "outline", size: "md" })}>
              <LayoutGrid className="h-4 w-4" aria-hidden /> Browse sets
            </Link>
            <Link href="/scan" className={buttonVariants({ variant: "primary", size: "md" })}>
              <Camera className="h-4 w-4" aria-hidden /> Scan a card
            </Link>
          </div>
        </div>

        {scans.length === 0 ? (
          <Card className="p-10 text-center">
            <Layers className="mx-auto mb-3 h-8 w-8 text-muted" aria-hidden />
            <p className="text-muted">
              Your collection is empty.{" "}
              <Link href="/scan" className="text-accent hover:underline">
                Scan your first card
              </Link>{" "}
              to start collecting.
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-8">
            {[...groups.entries()].map(([setName, cards]) => (
              <section key={setName}>
                <div className="mb-3 flex items-center gap-2">
                  <h2 className="text-lg font-semibold tracking-tight">{setName}</h2>
                  <Badge tone="primary">{cards.length}</Badge>
                </div>
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {cards.map((scan) => {
                    const fileName = path.basename(scan.imagePath);
                    return (
                      <li key={scan.id}>
                        <Link href={`/scan/${scan.id}`} className="block">
                          <Card className="flex items-center gap-4 p-4 transition-colors hover:border-white/20 hover:bg-elevated">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`/api/uploads/${fileName}`}
                              alt="Collected card"
                              className="h-20 w-16 shrink-0 rounded-lg border border-border object-cover"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium text-foreground">
                                {scan.predictions?.name?.value ?? "Unknown card"}
                              </p>
                              <p className="text-sm text-muted">
                                {scan.predictions?.rarity?.value ?? "—"} ·{" "}
                                {new Date(scan.createdAt).toLocaleDateString()}
                              </p>
                              <Badge tone="neutral" className="mt-2">
                                model {scan.modelVersion}
                              </Badge>
                            </div>
                          </Card>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </Container>
  );
}
