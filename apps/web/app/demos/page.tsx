import Link from "next/link";
import { demos } from "./registry";

export default async function DemosPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-2 text-3xl font-bold tracking-tight">Community demos</h1>
      <p className="mb-8 text-gray-600">
        These pages are built by classmates exploring ideas with AI. Anyone can
        add one: create a folder under <code>app/demos/&lt;slug&gt;/</code> with a{" "}
        <code>page.tsx</code> and add a single line to{" "}
        <code>app/demos/registry.ts</code>. See <code>docs/CONTRIBUTING.md</code>{" "}
        to get started.
      </p>
      <ul className="grid gap-4 sm:grid-cols-2">
        {demos.map((demo) => (
          <li key={demo.slug}>
            <Link
              href={`/demos/${demo.slug}`}
              className="block h-full rounded-lg border border-gray-200 bg-white p-5 transition hover:border-blue-400 hover:shadow-sm"
            >
              <h2 className="text-lg font-semibold">{demo.title}</h2>
              <p className="mt-1 text-sm text-gray-600">{demo.description}</p>
              <p className="mt-3 text-xs text-gray-400">by {demo.author}</p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
