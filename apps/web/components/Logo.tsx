import { ScanLine } from "lucide-react";

export default function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-primary to-accent text-white shadow-glow">
        <ScanLine className="h-5 w-5" strokeWidth={2.25} aria-hidden />
      </span>
      <span className="text-base font-semibold tracking-tight">
        TCG<span className="text-muted"> Recognizer</span>
      </span>
    </span>
  );
}
