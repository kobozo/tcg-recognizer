import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { askAssistant } from "@/lib/assistant";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { question?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) {
    return NextResponse.json({ error: "Ask a question." }, { status: 400 });
  }
  if (question.length > 2000) {
    return NextResponse.json({ error: "Question is too long." }, { status: 400 });
  }

  const { answer, error } = await askAssistant(session.user.id, question);
  if (error) {
    // 200 with an error message keeps the chat UI simple; it's not a server fault.
    return NextResponse.json({ error });
  }
  return NextResponse.json({ answer });
}
