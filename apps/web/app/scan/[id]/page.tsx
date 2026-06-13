import { notFound } from "next/navigation";
import path from "node:path";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import CardProfile from "@/components/CardProfile";
import type { CardPredictions, Enrichment } from "@/lib/types";

type StoredPredictions = CardPredictions & { enrichment?: Enrichment | null };

export default async function ScanResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) notFound();

  const scan = await db.scan.findUnique({ where: { id } });
  if (!scan || scan.userId !== session.user.id) notFound();

  const stored = scan.predictions as unknown as StoredPredictions;
  const { enrichment, ...predictions } = stored;
  const fileName = path.basename(scan.imagePath);

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-12">
      <h1 className="text-2xl font-bold">Card profile</h1>
      <CardProfile
        imageSrc={`/api/uploads/${fileName}`}
        predictions={predictions}
        enrichment={enrichment}
      />
    </main>
  );
}
