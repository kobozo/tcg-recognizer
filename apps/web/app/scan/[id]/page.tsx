import Link from "next/link";
import { notFound } from "next/navigation";
import path from "node:path";
import { ArrowLeft, Check, Boxes, Camera } from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import CardProfile from "@/components/CardProfile";
import FeedbackControl from "@/components/FeedbackControl";
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
        <Link
          href="/collection"
          className={buttonVariants({ variant: "ghost", size: "sm", className: "w-fit -ml-3" })}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back to collection
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-primary/20 text-emerald-300">
              <Check className="h-5 w-5" aria-hidden />
            </span>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Added to your collection
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/collection" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <Boxes className="h-4 w-4" aria-hidden /> View collection
            </Link>
            <Link href="/scan" className={buttonVariants({ variant: "primary", size: "sm" })}>
              <Camera className="h-4 w-4" aria-hidden /> Add another
            </Link>
          </div>
        </div>
        <CardProfile
          imageSrc={`/api/uploads/${fileName}`}
          predictions={predictions}
          enrichment={enrichment}
        />
        <FeedbackControl
          scanId={scan.id}
          game={scan.game}
          predictedName={predictions.name?.value ?? ""}
          predictedSet={predictions.set?.value}
          predictedNumber={predictions.card_number?.value}
        />
      </div>
    </Container>
  );
}
