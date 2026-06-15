import { NextResponse } from "next/server";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { predictCard } from "@/lib/inference";
import { ocrChannel, mergeOcrCandidates } from "@/lib/ocrChannel";
import { vlmEnabled, vlmDisambiguate } from "@/lib/vlm";
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

  // Predict (stubbed inference) then best-effort enrichment. A hung or failing
  // inference service must not surface as an unhandled 500.
  let predictions: CardPredictions;
  try {
    predictions = (await predictCard(image, game, embedding)) as CardPredictions;
  } catch {
    await rm(imagePath, { force: true }); // don't leave an orphaned upload
    return NextResponse.json({ error: "Recognition service unavailable" }, { status: 502 });
  }
  // The response is cast from `unknown`; guard the fields later code dereferences
  // (name.value, name.conf, model_version) before using them.
  if (
    !predictions?.name ||
    typeof predictions.name.value !== "string" ||
    typeof predictions.name.conf !== "number" ||
    typeof predictions.model_version !== "string"
  ) {
    await rm(imagePath, { force: true });
    return NextResponse.json({ error: "Recognition service unavailable" }, { status: 502 });
  }

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

  // Opt-in VLM-assisted disambiguation (gated by VLM_ASSIST, off by default). On
  // hard cases, a vision-language model reads the card and picks from the
  // shortlist. Best-effort: never throws and is a no-op when disabled, so the
  // default scan behavior is unchanged.
  // Only disambiguate with the VLM when the recognizer is uncertain — the same
  // confidence threshold CardProfile uses to surface candidates. A confident
  // recognition must not be overwritten.
  if (vlmEnabled() && predictions.name.conf < 0.6) {
    const candidateNames = [
      predictions.name.value,
      ...(predictions.name.candidates ?? []).map((c) => c.value),
    ].filter((v, i, a) => v && a.indexOf(v) === i);
    const vlm = await vlmDisambiguate(bytes, candidateNames);
    if (vlm) {
      predictions.vlm = vlm;
      if (vlm.pick) {
        // Reorder candidates so the VLM's pick is first, and make it the value.
        const rest = (predictions.name.candidates ?? []).filter(
          (c) => c.value.trim().toLowerCase() !== vlm.pick!.trim().toLowerCase(),
        );
        const picked = (predictions.name.candidates ?? []).find(
          (c) => c.value.trim().toLowerCase() === vlm.pick!.trim().toLowerCase(),
        ) ?? { value: vlm.pick, conf: predictions.name.conf };
        predictions.name.candidates = [picked, ...rest];
        predictions.name.value = vlm.pick;
      }
    }
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
