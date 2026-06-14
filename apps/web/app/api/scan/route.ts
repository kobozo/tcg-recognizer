import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { predictCard } from "@/lib/inference";
import { enrichCard } from "@/lib/enrich";
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

  const gameRaw = form.get("game");
  const game = gameRaw === "magic" ? "magic" : "pokemon";

  // Persist the uploaded bytes to the uploads volume.
  await mkdir(UPLOADS_DIR, { recursive: true });
  const fileName = `${randomUUID()}.jpg`;
  const imagePath = path.join(UPLOADS_DIR, fileName);
  const bytes = Buffer.from(await image.arrayBuffer());
  await writeFile(imagePath, bytes);

  // Predict (stubbed inference) then best-effort enrichment.
  const predictions = (await predictCard(image, game)) as CardPredictions;
  const enrichment = await enrichCard(predictions.name.value);

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
