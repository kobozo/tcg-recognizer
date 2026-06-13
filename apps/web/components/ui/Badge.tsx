type Tone = "neutral" | "primary" | "accent" | "success" | "danger";

const tones: Record<Tone, string> = {
  neutral: "border-border bg-white/5 text-muted",
  primary: "border-primary/30 bg-primary/15 text-emerald-300",
  accent: "border-accent/30 bg-accent/15 text-amber-300",
  success: "border-emerald-400/30 bg-emerald-400/15 text-emerald-300",
  danger: "border-destructive/30 bg-destructive/15 text-red-300",
};

export default function Badge({
  tone = "neutral",
  className = "",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}
      {...props}
    />
  );
}
