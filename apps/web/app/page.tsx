import Link from "next/link";
import type { Metadata } from "next";
import {
  Sparkles,
  Camera,
  ScanLine,
  Database,
  GitBranch,
  ArrowRight,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Container from "@/components/ui/Container";

export const metadata: Metadata = {
  title: "TCG Card Recognizer",
  description:
    "Recognize any Pokémon trading card in seconds. Snap a photo and get an instant attribute breakdown — name, type, set, rarity and more, with confidence scores.",
};

const features = [
  {
    icon: Camera,
    title: "Instant camera scan",
    description:
      "Point your phone at a card and capture it. No manual entry, no fuss — recognition starts the moment you snap.",
  },
  {
    icon: ScanLine,
    title: "Multi-label CV model",
    description:
      "A computer-vision model predicts name, type, set and rarity in a single pass, each with its own confidence score.",
  },
  {
    icon: Database,
    title: "Pokémon TCG API enrichment",
    description:
      "Predictions are enriched with official card data — full set details, market context and high-resolution artwork.",
  },
  {
    icon: GitBranch,
    title: "MLOps & admin",
    description:
      "Built-in tooling for monitoring, dataset curation and model retraining keeps recognition accurate over time.",
  },
];

export default function Home() {
  return (
    <main className="py-20 sm:py-28">
      <Container className="flex flex-col items-center gap-6 text-center">
        <Badge tone="accent" className="animate-fade-up">
          <Sparkles className="h-3.5 w-3.5" />
          AI-powered card recognition
        </Badge>
        <h1 className="animate-fade-up max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
          Recognize any{" "}
          <span className="text-gradient">Pokémon card</span> in seconds
        </h1>
        <p className="animate-fade-up max-w-xl text-lg text-muted">
          Snap a photo of your trading card and get an instant attribute
          breakdown — name, type, set, rarity and more, with confidence scores.
        </p>
        <div className="animate-fade-up flex flex-col items-center gap-3 sm:flex-row">
          <Link
            href="/scan"
            className={buttonVariants({ variant: "primary", size: "lg" })}
          >
            <Camera className="h-5 w-5" />
            Scan a card
          </Link>
          <Link
            href="/register"
            className={buttonVariants({ variant: "outline", size: "lg" })}
          >
            Create account
          </Link>
        </div>
      </Container>

      <Container className="mt-24">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight">
            Everything you need to identify cards
          </h2>
          <p className="mt-3 text-muted">
            From the lens to the ledger — a full pipeline from a raw photo to
            structured, enriched card data.
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
            Ready to scan your first card?
          </h2>
          <p className="max-w-lg text-muted">
            It takes seconds. Snap a photo and let the model do the rest.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <Link
              href="/scan"
              className={buttonVariants({ variant: "primary", size: "lg" })}
            >
              Scan a card
              <ArrowRight className="h-5 w-5" />
            </Link>
            <Link
              href="/register"
              className={buttonVariants({ variant: "ghost", size: "lg" })}
            >
              Create account
            </Link>
          </div>
        </div>
      </Container>
    </main>
  );
}
