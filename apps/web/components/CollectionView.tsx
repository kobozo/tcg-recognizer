"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Filter, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { formatMoney } from "@/lib/format";

export type CollectionCard = {
  id: string;
  name: string;
  game: string; // display name, e.g. "Pokémon"
  set: string;
  rarity: string;
  date: string;
  image: string;
  price?: number;
  currency?: string;
};

export default function CollectionView({ cards }: { cards: CollectionCard[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [game, setGame] = useState("all");
  const [set, setSet] = useState("all");
  const [rarity, setRarity] = useState("all");
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<string | null>(null);

  // Cards still present (optimistically drop ones the user just deleted).
  const live = useMemo(() => cards.filter((c) => !removed.has(c.id)), [cards, removed]);

  const games = useMemo(() => [...new Set(live.map((c) => c.game))].sort(), [live]);
  // Sets/rarities narrow to the chosen game for relevant options.
  const scoped = useMemo(
    () => (game === "all" ? live : live.filter((c) => c.game === game)),
    [live, game],
  );
  const sets = useMemo(() => [...new Set(scoped.map((c) => c.set))].sort(), [scoped]);
  const rarities = useMemo(() => [...new Set(scoped.map((c) => c.rarity))].sort(), [scoped]);

  const filtered = useMemo(
    () =>
      live.filter(
        (c) =>
          (game === "all" || c.game === game) &&
          (set === "all" || c.set === set) &&
          (rarity === "all" || c.rarity === rarity) &&
          (query === "" || c.name.toLowerCase().includes(query.toLowerCase())),
      ),
    [live, query, game, set, rarity],
  );

  async function onDelete(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm("Remove this card from your collection?")) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/scan/${id}`, { method: "DELETE" });
      if (!res.ok) {
        window.alert(
          res.status === 401
            ? "Your session expired — please log in again."
            : "Couldn't delete the card. Please try again.",
        );
        return;
      }
      setRemoved((prev) => new Set(prev).add(id));
      router.refresh();
    } catch {
      window.alert("Something went wrong. Please try again.");
    } finally {
      setDeleting(null);
    }
  }

  const selectClass =
    "h-11 rounded-xl border border-border bg-background/60 px-3 text-sm text-foreground focus:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your cards…"
            aria-label="Search your collection"
            className="h-11 w-full rounded-xl border border-border bg-background/60 pl-10 pr-4 text-sm text-foreground placeholder:text-muted/70 focus:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-4 w-4 text-muted" aria-hidden />
          <select
            value={game}
            onChange={(e) => {
              setGame(e.target.value);
              setSet("all");
              setRarity("all");
            }}
            aria-label="Filter by game"
            className={selectClass}
          >
            <option value="all">All games</option>
            {games.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <select
            value={set}
            onChange={(e) => setSet(e.target.value)}
            aria-label="Filter by set"
            className={selectClass}
          >
            <option value="all">All sets</option>
            {sets.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={rarity}
            onChange={(e) => setRarity(e.target.value)}
            aria-label="Filter by rarity"
            className={selectClass}
          >
            <option value="all">All rarities</option>
            {rarities.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-sm text-muted">
        Showing {filtered.length} of {live.length} cards
      </p>

      {filtered.length === 0 ? (
        <Card className="p-10 text-center text-muted">No cards match your filters.</Card>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((c) => (
            <li key={c.id} className="group relative">
              <button
                type="button"
                onClick={(e) => onDelete(e, c.id)}
                disabled={deleting === c.id}
                aria-label={`Remove ${c.name} from your collection`}
                title="Remove from collection"
                className="absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-full bg-background/80 text-muted backdrop-blur transition hover:bg-destructive/20 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
              <Link href={`/scan/${c.id}`} className="block">
                <Card className="overflow-hidden p-0 transition-all duration-200 hover:border-white/20 hover:shadow-glow">
                  <div className="aspect-[3/4] overflow-hidden bg-black/30">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={c.image}
                      alt={c.name}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                    />
                  </div>
                  <div className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-medium text-foreground">{c.name}</p>
                      {typeof c.price === "number" && (
                        <span className="shrink-0 text-sm font-semibold text-emerald-300">
                          {formatMoney(c.price, c.currency)}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted">{c.set}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Badge tone="neutral">{c.game}</Badge>
                      <Badge tone="accent">{c.rarity}</Badge>
                    </div>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
