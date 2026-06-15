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

  let body: {
    scanId?: unknown;
    correctedName?: unknown;
    correctedSet?: unknown;
    correctedNumber?: unknown;
    correctedCardId?: unknown;
    correct?: unknown;
  };
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

  const stored = scan.predictions as unknown as CardPredictions;
  const predicted = stored?.name?.value ?? "";
  const correct = body.correct === true;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");

  // On confirm, the corrected card IS the predicted one (name + set + number).
  const correctedName = correct ? predicted : str(body.correctedName);
  const correctedSet = correct ? str(stored?.set?.value) : str(body.correctedSet) || null;
  const correctedNumber = correct
    ? str(stored?.card_number?.value)
    : str(body.correctedNumber) || null;
  const correctedCardId = correct ? null : str(body.correctedCardId) || null;

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
      correctedSet,
      correctedNumber,
      correctedCardId,
      correct,
    },
    update: {
      correctedName,
      correctedSet,
      correctedNumber,
      correctedCardId,
      correct,
      predictedName: predicted,
    },
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
