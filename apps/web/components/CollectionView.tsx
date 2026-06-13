"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, Filter } from "lucide-react";
import { Card } from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";

export type CollectionCard = {
  id: string;
  name: string;
  set: string;
  rarity: string;
  date: string;
  image: string;
};

export default function CollectionView({ cards }: { cards: CollectionCard[] }) {
  const [query, setQuery] = useState("");
  const [set, setSet] = useState("all");
  const [rarity, setRarity] = useState("all");

  const sets = useMemo(
    () => [...new Set(cards.map((c) => c.set))].sort(),
    [cards],
  );
  const rarities = useMemo(
    () => [...new Set(cards.map((c) => c.rarity))].sort(),
    [cards],
  );

  const filtered = useMemo(
    () =>
      cards.filter(
        (c) =>
          (set === "all" || c.set === set) &&
          (rarity === "all" || c.rarity === rarity) &&
          (query === "" || c.name.toLowerCase().includes(query.toLowerCase())),
      ),
    [cards, query, set, rarity],
  );

  const selectClass =
    "h-11 rounded-xl border border-border bg-background/60 px-3 text-sm text-foreground focus:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60";

  return (
    <div className="flex flex-col gap-5">
      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
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
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted" aria-hidden />
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
        Showing {filtered.length} of {cards.length} cards
      </p>

      {filtered.length === 0 ? (
        <Card className="p-10 text-center text-muted">No cards match your filters.</Card>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((c) => (
            <li key={c.id}>
              <Link href={`/scan/${c.id}`} className="group block">
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
                    <p className="truncate text-sm font-medium text-foreground">{c.name}</p>
                    <p className="truncate text-xs text-muted">{c.set}</p>
                    <Badge tone="accent" className="mt-2">
                      {c.rarity}
                    </Badge>
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
