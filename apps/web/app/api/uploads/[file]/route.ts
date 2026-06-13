import { readFile } from "node:fs/promises";
import path from "node:path";
import { auth } from "@/lib/auth";

const UPLOADS_DIR = "/app/uploads";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { file } = await params;
  // Guard against path traversal: only allow a bare filename.
  const safeName = path.basename(file);
  const filePath = path.join(UPLOADS_DIR, safeName);

  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const ext = path.extname(safeName).toLowerCase();
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
