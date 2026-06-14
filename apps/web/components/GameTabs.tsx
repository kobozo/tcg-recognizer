import Link from "next/link";
import { listGames } from "@/lib/games";

/** Row of game tabs that link to `${basePath}/<gameId>` (e.g. /sets/pokemon). */
export default function GameTabs({
  basePath,
  current,
}: {
  basePath: string;
  current?: string;
}) {
  const games = listGames();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {games.map((g) => {
        const active = g.id === current;
        return (
          <Link
            key={g.id}
            href={`${basePath}/${g.id}`}
            aria-current={active ? "page" : undefined}
            className={`rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
              active
                ? "border-primary/40 bg-primary/15 text-emerald-300"
                : "border-border bg-surface/60 text-muted hover:bg-elevated hover:text-foreground"
            }`}
          >
            {g.name}
          </Link>
        );
      })}
    </div>
  );
}
