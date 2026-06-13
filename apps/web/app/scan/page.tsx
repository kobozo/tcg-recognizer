import type { Metadata } from "next";
import { Camera, Cpu, Database } from "lucide-react";
import Container from "@/components/ui/Container";
import Badge from "@/components/ui/Badge";
import CameraScanner from "@/components/CameraScanner";

export const metadata: Metadata = { title: "Scan a card · TCG Recognizer" };

const steps = [
  { icon: Camera, title: "Capture", text: "Frame the card with your camera" },
  { icon: Cpu, title: "Recognize", text: "The model reads name, type, set & rarity" },
  { icon: Database, title: "Enrich", text: "We add HP, attacks & price from the TCG API" },
];

export default function ScanPage() {
  return (
    <Container className="py-10 sm:py-14">
      <div className="mx-auto max-w-3xl animate-fade-up">
        <div className="mb-8 text-center">
          <Badge tone="primary" className="mb-4">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Add to collection
          </Badge>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Add a card to your collection
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-muted">
            Hold a card up to your camera and capture it — we&apos;ll recognize it and drop it
            straight into your collection.
          </p>
        </div>

        <div className="surface-panel p-5 sm:p-7">
          <CameraScanner />
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {steps.map((s, i) => (
            <div
              key={s.title}
              className="flex items-start gap-3 rounded-xl border border-border bg-surface/50 p-4"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/5 text-accent">
                <s.icon className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-medium">
                  <span className="text-muted">{i + 1}. </span>
                  {s.title}
                </p>
                <p className="text-sm text-muted">{s.text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Container>
  );
}
