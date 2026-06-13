type Props = { conf: number };

export default function ConfidenceBar({ conf }: Props) {
  const pct = Math.round(Math.max(0, Math.min(1, conf)) * 100);
  const color =
    conf >= 0.85 ? "bg-emerald-500" : conf >= 0.6 ? "bg-amber-500" : "bg-red-500";

  return (
    <div className="flex items-center gap-2">
      <div
        className="h-2 flex-1 overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 shrink-0 text-right text-xs font-medium text-muted">
        {pct}%
      </span>
    </div>
  );
}
