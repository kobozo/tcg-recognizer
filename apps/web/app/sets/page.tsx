import Link from "next/link";
import { Library, ArrowRight } from "lucide-react";
import { listGames } from "@/lib/games";
import Container from "@/components/ui/Container";
import { Card } from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";

export const metadata = { title: "Browse collections · TCG Recognizer" };

export default function GamesHubPage() {
  const games = listGames();
  return (
    <Container className="py-10 sm:py-14">
      <div className="animate-fade-up">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/5 text-accent">
            <Library className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Collections</h1>
            <p className="text-sm text-muted">Choose a trading card game to browse its sets</p>
          </div>
        </div>

        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {games.map((g) => (
            <li key={g.id}>
              <Link href={`/sets/${g.id}`} className="block h-full">
                <Card className="flex h-full items-center justify-between gap-4 p-6 transition-colors hover:border-white/20 hover:bg-elevated">
                  <div>
                    <span className={`mb-2 inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${g.accent}`}>
                      {g.name}
                    </span>
                    <p className="font-medium text-foreground">{g.full}</p>
                    {!g.available && (
                      <Badge tone="neutral" className="mt-2">
                        Coming soon
                      </Badge>
                    )}
                  </div>
                  <ArrowRight className="h-5 w-5 shrink-0 text-muted" aria-hidden />
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Container>
  );
}
