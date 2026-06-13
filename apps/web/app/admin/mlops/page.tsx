import { Cpu } from "lucide-react";
import { listModelVersions } from "@/lib/admin";
import { Card } from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";

function metric(metrics: unknown, key: string): string {
  if (metrics && typeof metrics === "object") {
    const v = (metrics as Record<string, unknown>)[key];
    if (typeof v === "number") return v.toFixed(3);
    if (typeof v === "string") return v;
  }
  return "—";
}

export default async function AdminMlopsPage() {
  const versions = await listModelVersions();

  if (versions.length === 0) {
    return (
      <section>
        <h2 className="mb-4 text-lg font-semibold tracking-tight">Model versions</h2>
        <Card className="flex h-40 flex-col items-center justify-center gap-3 border-dashed text-center">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/5 text-muted">
            <Cpu className="h-5 w-5" aria-hidden />
          </span>
          <p className="text-sm text-muted">
            No models trained yet — train one in Phase ③.
          </p>
        </Card>
      </section>
    );
  }

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold tracking-tight">Model versions</h2>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left">
            <tr className="border-b border-border">
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
                Version
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
                Trained
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
                Dataset size
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
                Accuracy
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
                F1
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
                Current
              </th>
            </tr>
          </thead>
          <tbody>
            {versions.map((m) => (
              <tr key={m.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-mono text-foreground">{m.version}</td>
                <td className="px-4 py-3 text-muted">
                  {new Date(m.trainedAt).toISOString().slice(0, 10)}
                </td>
                <td className="px-4 py-3 text-foreground">{m.datasetSize}</td>
                <td className="px-4 py-3 text-foreground">{metric(m.metrics, "accuracy")}</td>
                <td className="px-4 py-3 text-foreground">{metric(m.metrics, "f1")}</td>
                <td className="px-4 py-3">
                  {m.isCurrent && <Badge tone="success">current</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </section>
  );
}
