import Link from "next/link";
import path from "node:path";
import { redirect } from "next/navigation";
import { Camera } from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import Container from "@/components/ui/Container";
import { Card } from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { buttonVariants } from "@/components/ui/Button";
import type { CardPredictions } from "@/lib/types";

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/account");

  const scans = await db.scan.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <Container className="py-10 sm:py-14">
      <div className="animate-fade-up">
        <div className="mb-8 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">My scans</h1>
          <Link href="/scan" className={buttonVariants({ variant: "primary", size: "md" })}>
            <Camera className="h-4 w-4" aria-hidden /> Scan a card
          </Link>
        </div>

        {scans.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-muted">
              You haven&apos;t scanned any cards yet.{" "}
              <Link href="/scan" className="text-accent hover:underline">
                Upload your first card
              </Link>
              .
            </p>
          </Card>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {scans.map((scan) => {
              const predictions = scan.predictions as unknown as CardPredictions;
              const fileName = path.basename(scan.imagePath);
              return (
                <li key={scan.id}>
                  <Link href={`/scan/${scan.id}`} className="block">
                    <Card className="flex items-center gap-4 p-4 transition-colors hover:border-white/20 hover:bg-elevated">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/uploads/${fileName}`}
                        alt="Scanned card"
                        className="h-20 w-16 shrink-0 rounded-lg border border-border object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-foreground">
                          {predictions?.name?.value ?? "Unknown card"}
                        </p>
                        <p className="text-sm text-muted">
                          {predictions?.type?.value ?? "—"} ·{" "}
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
        )}
      </div>
    </Container>
  );
}
