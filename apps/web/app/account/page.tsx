import Link from "next/link";
import path from "node:path";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { CardPredictions } from "@/lib/types";

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/account");

  const scans = await db.scan.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My scans</h1>
        <Link
          href="/scan"
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Scan a card
        </Link>
      </div>

      {scans.length === 0 ? (
        <p className="text-gray-600">
          You haven&apos;t scanned any cards yet.{" "}
          <Link href="/scan" className="text-blue-600 hover:underline">
            Upload your first card
          </Link>
          .
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {scans.map((scan) => {
            const predictions = scan.predictions as unknown as CardPredictions;
            const fileName = path.basename(scan.imagePath);
            return (
              <li
                key={scan.id}
                className="rounded-lg border border-gray-200 bg-white p-4 hover:border-blue-400"
              >
                <Link href={`/scan/${scan.id}`} className="flex items-center gap-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/uploads/${fileName}`}
                    alt="Scanned card"
                    className="h-20 w-16 rounded object-cover"
                  />
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {predictions?.name?.value ?? "Unknown card"}
                    </p>
                    <p className="text-sm text-gray-500">
                      {predictions?.type?.value ?? "—"} ·{" "}
                      {new Date(scan.createdAt).toLocaleDateString()}
                    </p>
                    <p className="text-xs text-gray-400">model {scan.modelVersion}</p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
