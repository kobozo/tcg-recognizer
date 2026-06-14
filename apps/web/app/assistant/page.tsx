"use client";

import { useRef, useState } from "react";
import { Sparkles, Send, Bot, User } from "lucide-react";
import Container from "@/components/ui/Container";
import { Card } from "@/components/ui/Card";
import Button from "@/components/ui/Button";

type Turn = { role: "user" | "assistant"; text: string; error?: boolean };

const SUGGESTIONS = [
  "What's my collection worth?",
  "Which set am I closest to completing?",
  "What should I chase next?",
  "Which of my cards is the most valuable?",
];

export default function AssistantPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    setTurns((t) => [...t, { role: "user", text: q }]);
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = (await res.json()) as { answer?: string; error?: string };
      setTurns((t) => [
        ...t,
        data.error
          ? { role: "assistant", text: data.error, error: true }
          : { role: "assistant", text: data.answer ?? "" },
      ]);
    } catch {
      setTurns((t) => [
        ...t,
        { role: "assistant", text: "Something went wrong. Please try again.", error: true },
      ]);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
    }
  }

  return (
    <Container className="py-10 sm:py-14">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 animate-fade-up">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-primary to-accent text-white shadow-glow">
            <Sparkles className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Collection assistant</h1>
            <p className="text-sm text-muted">Ask anything about your collection — value, gaps, what to chase.</p>
          </div>
        </div>

        {turns.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => ask(s)}
                className="rounded-full border border-border bg-surface/60 px-3 py-1.5 text-sm text-muted transition-colors hover:bg-elevated hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-4">
          {turns.map((t, i) => (
            <div key={i} className={`flex gap-3 ${t.role === "user" ? "flex-row-reverse" : ""}`}>
              <span
                className={`mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                  t.role === "user" ? "bg-white/5 text-muted" : "bg-primary/15 text-emerald-300"
                }`}
              >
                {t.role === "user" ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
              </span>
              <Card
                className={`max-w-[85%] whitespace-pre-wrap p-4 text-sm ${
                  t.error ? "border-destructive/30 text-red-300" : "text-foreground"
                }`}
              >
                {t.text}
              </Card>
            </div>
          ))}
          {busy && <p className="text-sm text-muted">Thinking…</p>}
          <div ref={endRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
          className="sticky bottom-4 flex items-center gap-2 rounded-2xl border border-border bg-background/80 p-2 backdrop-blur-xl"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your collection…"
            aria-label="Ask the assistant"
            disabled={busy}
            className="h-11 flex-1 bg-transparent px-3 text-sm text-foreground placeholder:text-muted/70 focus:outline-none"
          />
          <Button type="submit" size="icon" disabled={busy || !input.trim()} aria-label="Send">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </Container>
  );
}
