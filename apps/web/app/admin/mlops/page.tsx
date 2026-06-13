import { listModelVersions } from "@/lib/admin";

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
        <h2 className="mb-4 text-lg font-semibold">Model versions</h2>
        <div className="flex h-32 items-center justify-center rounded border border-dashed border-gray-300 text-sm text-gray-500">
          No models trained yet — train one in Phase ③.
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold">Model versions</h2>
      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-4 py-2 font-medium">Version</th>
              <th className="px-4 py-2 font-medium">Trained</th>
              <th className="px-4 py-2 font-medium">Dataset size</th>
              <th className="px-4 py-2 font-medium">Accuracy</th>
              <th className="px-4 py-2 font-medium">F1</th>
              <th className="px-4 py-2 font-medium">Current</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {versions.map((m) => (
              <tr key={m.id}>
                <td className="px-4 py-2 font-mono">{m.version}</td>
                <td className="px-4 py-2 text-gray-600">
                  {new Date(m.trainedAt).toISOString().slice(0, 10)}
                </td>
                <td className="px-4 py-2">{m.datasetSize}</td>
                <td className="px-4 py-2">{metric(m.metrics, "accuracy")}</td>
                <td className="px-4 py-2">{metric(m.metrics, "f1")}</td>
                <td className="px-4 py-2">
                  {m.isCurrent && (
                    <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">
                      current
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
