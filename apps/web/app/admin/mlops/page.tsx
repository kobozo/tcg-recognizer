import { Cpu, ExternalLink } from "lucide-react";
import { listModelVersions } from "@/lib/admin";
import { Card } from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { buttonVariants } from "@/components/ui/Button";

const MLFLOW_URL = process.env.NEXT_PUBLIC_MLFLOW_URL ?? "http://192.168.3.177:5000";

function metric(metrics: unknown, key: string): string {
  if (metrics && typeof metrics === "object") {
    const v = (metrics as Record<string, unknown>)[key];
    if (typeof v === "number") return v.toFixed(3);
    if (typeof v === "string") return v;
  }
  return "—";
}

function runId(metrics: unknown): string | null {
  if (metrics && typeof metrics === "object") {
    const v = (metrics as Record<string, unknown>)["mlflow_run_id"];
    if (typeof v === "string") return v;
  }
  return null;
}

export default async function AdminMlopsPage() {
  const versions = await listModelVersions();

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Model versions</h2>
        <a
          href={MLFLOW_URL}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ExternalLink className="h-4 w-4" aria-hidden /> Open MLflow
        </a>
      </div>

      {versions.length === 0 ? (
        <Card className="flex h-44 flex-col items-center justify-center gap-3 border-dashed text-center">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/5 text-muted">
            <Cpu className="h-5 w-5" aria-hidden />
          </span>
          <p className="text-sm text-muted">
            No models trained yet. Run a rebuild:
            <br />
            <code className="text-foreground">docker compose run --rm trainer</code>
          </p>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left">
              <tr className="border-b border-border">
                {["Version", "Trained", "Dataset", "Recall@1", "MLflow", "Current"].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {versions.map((m) => {
                const rid = runId(m.metrics);
                return (
                  <tr key={m.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-mono text-foreground">{m.version}</td>
                    <td className="px-4 py-3 text-muted">
                      {new Date(m.trainedAt).toISOString().slice(0, 10)}
                    </td>
                    <td className="px-4 py-3 text-foreground">{m.datasetSize}</td>
                    <td className="px-4 py-3 text-foreground">{metric(m.metrics, "recall_at_1")}</td>
                    <td className="px-4 py-3">
                      {rid ? (
                        <a
                          href={`${MLFLOW_URL}/#/experiments/0?searchFilter=&runId=${rid}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-xs text-emerald-300 hover:underline"
                        >
                          {rid.slice(0, 8)}
                        </a>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {m.isCurrent && <Badge tone="success">current</Badge>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  );
}
