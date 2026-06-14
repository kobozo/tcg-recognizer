import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { CardPredictions } from "@/lib/types";

/**
 * Record a human-in-the-loop label for a scan: the user confirms the prediction
 * was right, or corrects it. These become the active-learning signal the trainer
 * feeds back into the recognition index.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { scanId?: unknown; correctedName?: unknown; correct?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const scanId = typeof body.scanId === "string" ? body.scanId : "";
  if (!scanId) {
    return NextResponse.json({ error: "scanId required" }, { status: 400 });
  }

  const scan = await db.scan.findUnique({ where: { id: scanId } });
  if (!scan || scan.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const predicted = (scan.predictions as unknown as CardPredictions)?.name?.value ?? "";
  const correct = body.correct === true;
  const correctedName = correct
    ? predicted
    : typeof body.correctedName === "string" && body.correctedName.trim()
      ? body.correctedName.trim()
      : "";
  if (!correctedName) {
    return NextResponse.json({ error: "correctedName required" }, { status: 400 });
  }

  await db.feedback.upsert({
    where: { scanId },
    create: {
      scanId,
      userId: session.user.id,
      game: scan.game,
      predictedName: predicted,
      correctedName,
      correct,
    },
    update: { correctedName, correct, predictedName: predicted },
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
