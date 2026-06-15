import { NextResponse } from "next/server";
import { rm } from "node:fs/promises";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * Delete a scanned card from the user's collection. Enforces ownership, removes
 * the row (its Feedback cascades via onDelete: Cascade) and best-effort deletes
 * the uploaded image file.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const scan = await db.scan.findUnique({ where: { id } });
  if (!scan || scan.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.scan.delete({ where: { id } });
  if (scan.imagePath) {
    try {
      await rm(scan.imagePath, { force: true });
    } catch {
      // best-effort: the row is gone; an orphaned file is harmless
    }
  }

  return NextResponse.json({ ok: true });
}
