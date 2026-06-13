import Link from "next/link";
import { notFound } from "next/navigation";
import path from "node:path";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import CardProfile from "@/components/CardProfile";
import Container from "@/components/ui/Container";
import { buttonVariants } from "@/components/ui/Button";
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
    <Container className="py-10 sm:py-14">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 animate-fade-up">
        <div className="flex flex-col gap-3">
          <Link
            href="/scan"
            className={buttonVariants({ variant: "ghost", size: "sm", className: "w-fit -ml-3" })}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back to scan
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Card profile
          </h1>
        </div>
        <CardProfile
          imageSrc={`/api/uploads/${fileName}`}
          predictions={predictions}
          enrichment={enrichment}
        />
      </div>
    </Container>
  );
}
