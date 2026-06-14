import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  Sparkles,
  Camera,
  Boxes,
  Library,
  TrendingUp,
  ArrowRight,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { buttonVariants } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Container from "@/components/ui/Container";

export const metadata: Metadata = {
  title: "TCG Card Recognizer — your trading card collection",
  description:
    "Build your trading card collection by scanning cards with your camera — Pokémon, Magic and more. Track sets, completion and rarities, instantly.",
};

const features = [
  {
    icon: Camera,
    title: "Scan to add",
    description:
      "Point your camera at a card and it's added to your collection in seconds — name, set and rarity recognized automatically.",
  },
  {
    icon: Boxes,
    title: "Organized by set",
    description:
      "Your cards are grouped into their official sets, with completion bars so you always know what's missing.",
  },
  {
    icon: Library,
    title: "Every official set",
    description:
      "Browse all sets across each game from official APIs (Pokémon TCG API, Scryfall) and see how many of each you own.",
  },
  {
    icon: TrendingUp,
    title: "Track your progress",
    description:
      "Cards, unique cards, sets and rarities at a glance — watch your collection grow over time.",
  },
];

export default async function Home() {
  const session = await auth();
  // Collectors land straight on their collection — it's the heart of the app.
  if (session?.user) redirect("/collection");

  return (
    <main className="py-20 sm:py-28">
      <Container className="flex flex-col items-center gap-6 text-center">
        <Badge tone="accent" className="animate-fade-up">
          <Sparkles className="h-3.5 w-3.5" />
          Pokémon · Magic · and more
        </Badge>
        <h1 className="animate-fade-up max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
          Build your <span className="text-gradient">card collection</span> by scanning
        </h1>
        <p className="animate-fade-up max-w-xl text-lg text-muted">
          Snap any supported card — Pokémon, Magic and more — and it&apos;s instantly recognized
          and added to your collection. Track sets, completion and rarities, all in one place.
        </p>
        <div className="animate-fade-up flex flex-col items-center gap-3 sm:flex-row">
          <Link href="/register" className={buttonVariants({ variant: "primary", size: "lg" })}>
            <Boxes className="h-5 w-5" />
            Start your collection
          </Link>
          <Link href="/scan" className={buttonVariants({ variant: "outline", size: "lg" })}>
            <Camera className="h-5 w-5" />
            Scan a card
          </Link>
        </div>
      </Container>

      <Container className="mt-24">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight">A home for your cards</h2>
          <p className="mt-3 text-muted">
            Scan, organize and complete your sets — the camera does the cataloguing.
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map(({ icon: Icon, title, description }) => (
            <Card key={title} className="transition-all hover:border-white/20 hover:shadow-glow">
              <CardHeader>
                <span className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-emerald-300">
                  <Icon className="h-5 w-5" />
                </span>
                <CardTitle>{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </Container>

      <Container className="mt-24">
        <div className="surface-panel flex flex-col items-center gap-6 rounded-3xl px-6 py-14 text-center">
          <h2 className="max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
            Start collecting today
          </h2>
          <p className="max-w-lg text-muted">
            Create your free account and scan your first card — your collection starts here.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <Link href="/register" className={buttonVariants({ variant: "primary", size: "lg" })}>
              Start your collection
              <ArrowRight className="h-5 w-5" />
            </Link>
            <Link href="/scan" className={buttonVariants({ variant: "ghost", size: "lg" })}>
              Scan a card
            </Link>
          </div>
        </div>
      </Container>
    </main>
  );
}
