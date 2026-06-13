import ConfidenceBar from "@/components/ConfidenceBar";
import type { CardPredictions, Enrichment, Prediction } from "@/lib/types";

type Props = {
  imageSrc: string;
  predictions: CardPredictions;
  enrichment?: Enrichment | null;
};

const FIELDS: { key: keyof CardPredictions; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "type", label: "Type" },
  { key: "set", label: "Set" },
  { key: "rarity", label: "Rarity" },
  { key: "card_number", label: "Card number" },
];

function AttributeRow({ label, pred }: { label: string; pred: Prediction }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
          {label}
        </span>
        <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-sm font-semibold text-gray-800">
          {pred.value || "—"}
        </span>
      </div>
      <ConfidenceBar conf={pred.conf} />
    </div>
  );
}

export default function CardProfile({ imageSrc, predictions, enrichment }: Props) {
  const name = predictions.name;
  const showCandidates =
    name.conf < 0.6 && Array.isArray(name.candidates) && name.candidates.length > 0;

  return (
    <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
      {/* Left: uploaded image */}
      <div className="flex items-start justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageSrc}
          alt="Uploaded card"
          className="max-h-[28rem] w-full rounded-lg border border-gray-200 object-contain"
        />
      </div>

      {/* Right: predicted attributes */}
      <div className="flex flex-col gap-5">
        {FIELDS.map(({ key, label }) => (
          <AttributeRow key={key} label={label} pred={predictions[key] as Prediction} />
        ))}

        {showCandidates && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-800">Did you mean?</p>
            <ul className="mt-2 flex flex-col gap-1">
              {name.candidates!.map((c, i) => (
                <li
                  key={`${c.value}-${i}`}
                  className="flex items-center justify-between text-sm text-amber-900"
                >
                  <span>{c.value}</span>
                  <span className="text-xs text-amber-700">
                    {Math.round(c.conf * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {enrichment && (
          <div className="rounded-lg border-2 border-emerald-400 bg-emerald-50 p-4">
            <p className="text-sm font-semibold text-emerald-800">
              Verified from Pokémon TCG API
            </p>
            <dl className="mt-2 flex flex-col gap-1 text-sm text-emerald-900">
              {enrichment.hp && (
                <div className="flex justify-between gap-4">
                  <dt className="font-medium">HP</dt>
                  <dd>{enrichment.hp}</dd>
                </div>
              )}
              {enrichment.attacks && enrichment.attacks.length > 0 && (
                <div className="flex justify-between gap-4">
                  <dt className="font-medium">Attacks</dt>
                  <dd className="text-right">{enrichment.attacks.join(", ")}</dd>
                </div>
              )}
              {enrichment.priceIndicator && (
                <div className="flex justify-between gap-4">
                  <dt className="font-medium">Price</dt>
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
