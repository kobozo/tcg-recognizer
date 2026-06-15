"use client";

import { useEffect, useRef, useState } from "react";
import { ThumbsUp, PencilLine, Check, Search } from "lucide-react";
import Button, { buttonVariants } from "@/components/ui/Button";

type Result = {
  id: string;
  name: string;
  set: string;
  setId: string;
  number: string;
  image?: string;
};

export default function FeedbackControl({
  scanId,
  game,
  predictedName,
  predictedSet,
  predictedNumber,
}: {
  scanId: string;
  game: string;
  predictedName: string;
  predictedSet?: string;
  predictedNumber?: string;
}) {
  const [mode, setMode] = useState<"idle" | "correcting" | "done">("idle");
  const [query, setQuery] = useState(predictedName ?? "");
  const [results, setResults] = useState<Result[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced card search (by name) → candidates carrying set + number.
  useEffect(() => {
    if (mode !== "correcting") return;
    const q = query.trim();
    if (debounce.current) clearTimeout(debounce.current);
    if (q.length < 2) {
      setResults([]);
      return;
    }
    debounce.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/cards/search?game=${encodeURIComponent(game)}&q=${encodeURIComponent(q)}`,
        );
        if (res.ok) {
          const data = (await res.json()) as { results: Result[] };
          setResults(data.results ?? []);
        }
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query, mode, game]);

  async function send(payload: {
    correct?: boolean;
    correctedName?: string;
    correctedSet?: string;
    correctedNumber?: string;
    correctedCardId?: string;
  }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanId, ...payload }),
      });
      if (res.status === 401) {
        setError("Your session expired. Please log in again.");
        return;
      }
      if (!res.ok) {
        setError("Couldn't save your feedback. Please try again.");
        return;
      }
      setMode("done");
    } catch {
      setError("Something went wrong. Please try again.");
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

  const predictedLine = [predictedSet, predictedNumber ? `#${predictedNumber}` : ""]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="rounded-xl border border-border bg-surface/50 p-4">
      {mode === "idle" ? (
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <p className="text-sm text-muted">Is this the right card?</p>
            <p className="text-sm font-medium text-foreground">
              {predictedName || "Unknown"}
              {predictedLine && <span className="text-muted"> — {predictedLine}</span>}
            </p>
          </div>
          <Button size="sm" disabled={busy} onClick={() => send({ correct: true })}>
            <ThumbsUp className="h-4 w-4" aria-hidden /> Looks right
          </Button>
          <Button variant="outline" size="sm" onClick={() => setMode("correcting")}>
            <PencilLine className="h-4 w-4" aria-hidden /> Not quite
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <span className="text-sm text-muted">
            Find the correct card — pick the right collection &amp; number:
          </span>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type the card name…"
              className="h-10 w-full rounded-xl border border-border bg-background/60 pl-9 pr-3 text-sm text-foreground placeholder:text-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            />
          </div>

          {searching && <p className="text-xs text-muted">Searching…</p>}

          {results.length > 0 && (
            <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-xl border border-border">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    disabled={busy}
                    onClick={() =>
                      send({
                        correctedName: r.name,
                        correctedSet: r.set,
                        correctedNumber: r.number,
                        correctedCardId: r.id,
                      })
                    }
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface/80 disabled:opacity-50"
                  >
                    <span className="h-12 w-9 shrink-0 overflow-hidden rounded bg-black/30">
                      {r.image && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.image} alt="" className="h-full w-full object-cover" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {r.name}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {r.set || "Unknown set"}
                        {r.number ? ` · #${r.number}` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!searching && query.trim().length >= 2 && results.length === 0 && (
            <p className="text-xs text-muted">No cards found — try a different spelling.</p>
          )}

          <button
            onClick={() => setMode("idle")}
            className={buttonVariants({ variant: "ghost", size: "sm", className: "w-fit" })}
          >
            Cancel
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
