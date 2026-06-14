import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { predictCard } from "@/lib/inference";
import { ocrChannel, mergeOcrCandidates } from "@/lib/ocrChannel";
import { enrichCard } from "@/lib/enrich";
import { isGameEnabled } from "@/lib/games";
import type { CardPredictions } from "@/lib/types";

const UPLOADS_DIR = "/app/uploads";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const image = form.get("image");
  if (!(image instanceof File) || image.size === 0) {
    return NextResponse.json({ error: "Missing image" }, { status: 400 });
  }
  if (!image.type.startsWith("image/")) {
    return NextResponse.json({ error: "File must be an image" }, { status: 400 });
  }

  const gameRaw = typeof form.get("game") === "string" ? String(form.get("game")) : "pokemon";
  // Only accept games enabled for this deployment; otherwise fall back to Pokémon.
  const game = isGameEnabled(gameRaw) ? gameRaw : "pokemon";

  // Optional on-device embedding (computed in the browser). Passed through to
  // inference, which then skips server-side embedding and just does the lookup.
  let embedding: number[] | undefined;
  const embRaw = form.get("embedding");
  if (typeof embRaw === "string" && embRaw.length > 0) {
    try {
      const parsed: unknown = JSON.parse(embRaw);
      if (Array.isArray(parsed) && parsed.every((n) => typeof n === "number")) {
        embedding = parsed as number[];
      }
    } catch {
      // ignore malformed client embedding; fall back to server-side embedding
    }
  }

  // Persist the uploaded bytes to the uploads volume.
  await mkdir(UPLOADS_DIR, { recursive: true });
  const fileName = `${randomUUID()}.jpg`;
  const imagePath = path.join(UPLOADS_DIR, fileName);
  const bytes = Buffer.from(await image.arrayBuffer());
  await writeFile(imagePath, bytes);

  // Predict (stubbed inference) then best-effort enrichment.
  const predictions = (await predictCard(image, game, embedding)) as CardPredictions;

  // Opt-in OCR + Qdrant text channel (extras): fold its top matches in as extra
  // candidates. When the user confirms/corrects one, it becomes a Feedback row
  // the trainer folds into the index — that's how this extra teaches the model.
  const ocr = await ocrChannel(image, game);
  if (ocr) {
    predictions.name.candidates = mergeOcrCandidates(
      predictions.name.candidates,
      ocr.candidates,
      predictions.name.value,
    );
    predictions.ocr = { text: ocr.text, source: "qdrant" };
  }

  const enrichment = await enrichCard(predictions.name.value, game);

  const scan = await db.scan.create({
    data: {
      userId: session.user.id,
      game,
      imagePath,
      predictions: { ...predictions, enrichment },
      modelVersion: predictions.model_version,
    },
    select: { id: true },
  });

  return NextResponse.json({ id: scan.id }, { status: 201 });
}
