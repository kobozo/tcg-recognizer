"use client";

import { useState } from "react";
import { ThumbsUp, PencilLine, Check } from "lucide-react";
import Button, { buttonVariants } from "@/components/ui/Button";

export default function FeedbackControl({
  scanId,
  predictedName,
  candidates,
}: {
  scanId: string;
  predictedName: string;
  candidates: string[];
}) {
  const [mode, setMode] = useState<"idle" | "correcting" | "done">("idle");
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(payload: { correct?: boolean; correctedName?: string }) {
    setBusy(true);
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanId, ...payload }),
      });
      setMode("done");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "done") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
        <Check className="h-4 w-4" aria-hidden /> Thanks — confirmations train the model on real photos.
      </div>
    );
  }

  const others = candidates.filter((c) => c && c !== predictedName).slice(0, 3);

  return (
    <div className="rounded-xl border border-border bg-surface/50 p-4">
      {mode === "idle" ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted">Is this the right card?</span>
          <Button size="sm" disabled={busy} onClick={() => send({ correct: true })}>
            <ThumbsUp className="h-4 w-4" aria-hidden /> Looks right
          </Button>
          <Button variant="outline" size="sm" onClick={() => setMode("correcting")}>
            <PencilLine className="h-4 w-4" aria-hidden /> Not quite
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <span className="text-sm text-muted">Which card is it?</span>
          {others.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {others.map((c) => (
                <button
                  key={c}
                  disabled={busy}
                  onClick={() => send({ correctedName: c })}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (custom.trim()) send({ correctedName: custom.trim() });
            }}
            className="flex items-center gap-2"
          >
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Type the correct card name…"
              className="h-10 flex-1 rounded-xl border border-border bg-background/60 px-3 text-sm text-foreground placeholder:text-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            />
            <Button size="sm" type="submit" disabled={busy || !custom.trim()}>
              Submit
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
