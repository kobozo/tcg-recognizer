import { BadgeCheck, Eye, Sparkles } from "lucide-react";
import ConfidenceBar from "@/components/ConfidenceBar";
import Badge from "@/components/ui/Badge";
import { formatMoney } from "@/lib/format";
import type { CardPredictions, Enrichment, Prediction } from "@/lib/types";

type Props = {
  imageSrc: string;
  predictions: CardPredictions;
  enrichment?: Enrichment | null;
};

// Collection (set), name and number are the focus — they identify the exact
// card; type/rarity are secondary.
const FIELDS: { key: keyof CardPredictions; label: string }[] = [
  { key: "name", label: "Card name" },
  { key: "set", label: "Collection" },
  { key: "card_number", label: "Card number" },
  { key: "type", label: "Type" },
  { key: "rarity", label: "Rarity" },
];

function AttributeRow({ label, pred }: { label: string; pred?: Prediction }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          {label}
        </span>
        <Badge tone="neutral" className="text-sm font-semibold text-foreground">
          {pred?.value || "—"}
        </Badge>
      </div>
      <ConfidenceBar conf={pred?.conf ?? 0} />
    </div>
  );
}

export default function CardProfile({ imageSrc, predictions, enrichment }: Props) {
  const name = predictions.name;
  const showCandidates =
    !!name && name.conf < 0.6 && Array.isArray(name.candidates) && name.candidates.length > 0;

  return (
    <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
      {/* Left: uploaded image */}
      <div className="flex items-start justify-center">
        <div className="w-full overflow-hidden rounded-2xl border border-border bg-surface/70 p-3 shadow-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageSrc}
            alt="Uploaded card"
            className="max-h-[28rem] w-full rounded-lg object-contain"
          />
        </div>
      </div>

      {/* Right: predicted attributes */}
      <div className="flex flex-col gap-5">
        {/* Focus: collection · card name · number — what identifies the card */}
        <div className="rounded-xl border border-border bg-surface/60 p-4">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            {name?.value || "Unknown card"}
          </h2>
          <p className="mt-1 text-sm text-muted">
            <span className="font-medium text-foreground/90">
              {predictions.set?.value || "Unknown collection"}
            </span>
            {predictions.card_number?.value ? ` · #${predictions.card_number.value}` : ""}
          </p>
        </div>

        {FIELDS.map(({ key, label }) => (
          <AttributeRow key={key} label={label} pred={predictions[key] as Prediction | undefined} />
        ))}

        {showCandidates && (
          <div className="rounded-xl border border-accent/30 bg-accent/10 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-amber-300">
              <Sparkles className="h-4 w-4" aria-hidden /> Did you mean?
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {name.candidates!.map((c, i) => (
                <li
                  key={`${c.value}-${i}`}
                  className="flex items-center justify-between text-sm text-amber-200"
                >
                  <span>{c.value}</span>
                  <span className="text-xs text-amber-300/80">
                    {Math.round(c.conf * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {predictions.vlm && predictions.vlm.text && (
          <div className="rounded-xl border border-sky-400/30 bg-sky-500/10 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-sky-300">
              <Eye className="h-4 w-4" aria-hidden /> AI read
            </p>
            <p className="mt-1 text-sm text-sky-100">{predictions.vlm.text}</p>
            <p className="mt-1 text-xs text-sky-300/70">
              via {predictions.vlm.provider} vision
            </p>
          </div>
        )}

        {enrichment && (
          <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
              <BadgeCheck className="h-4 w-4" aria-hidden /> Verified market data
            </p>
            {typeof enrichment.price === "number" && (
              <div className="mt-2 flex items-baseline justify-between gap-4 border-b border-emerald-400/20 pb-2">
                <span className="text-sm font-medium text-emerald-300/90">Estimated value</span>
                <span className="text-2xl font-bold text-emerald-200">
                  {formatMoney(enrichment.price, enrichment.currency)}
                </span>
              </div>
            )}
            <dl className="mt-2 flex flex-col gap-1 text-sm text-emerald-100">
              {enrichment.hp && (
                <div className="flex justify-between gap-4">
                  <dt className="font-medium text-emerald-300/90">HP</dt>
                  <dd>{enrichment.hp}</dd>
                </div>
              )}
              {enrichment.attacks && enrichment.attacks.length > 0 && (
                <div className="flex justify-between gap-4">
                  <dt className="font-medium text-emerald-300/90">Attacks</dt>
                  <dd className="text-right">{enrichment.attacks.join(", ")}</dd>
                </div>
              )}
              {enrichment.priceIndicator && (
                <div className="flex justify-between gap-4">
                  <dt className="font-medium text-emerald-300/90">Price</dt>
                  <dd>{enrichment.priceIndicator}</dd>
                </div>
              )}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}
