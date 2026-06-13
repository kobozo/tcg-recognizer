import Link from "next/link";
import { User } from "lucide-react";
import { demos } from "./registry";
import Container from "@/components/ui/Container";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";

export default async function DemosPage() {
  return (
    <main className="py-12">
      <Container>
        <h1 className="mb-2 text-3xl font-bold tracking-tight sm:text-4xl">
          Community demos
        </h1>
        <p className="mb-10 max-w-2xl text-muted">
          These pages are built by classmates exploring ideas with AI. Anyone can
          add one: create a folder under{" "}
          <code className="rounded bg-white/5 px-1.5 py-0.5 text-foreground/90">
            app/demos/&lt;slug&gt;/
          </code>{" "}
          with a{" "}
          <code className="rounded bg-white/5 px-1.5 py-0.5 text-foreground/90">
            page.tsx
          </code>{" "}
          and add a single line to{" "}
          <code className="rounded bg-white/5 px-1.5 py-0.5 text-foreground/90">
            app/demos/registry.ts
          </code>
          . See{" "}
          <code className="rounded bg-white/5 px-1.5 py-0.5 text-foreground/90">
            docs/CONTRIBUTING.md
          </code>{" "}
          to get started.
        </p>
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {demos.map((demo) => (
            <li key={demo.slug}>
              <Link href={`/demos/${demo.slug}`} className="group block h-full">
                <Card className="h-full transition-all group-hover:border-white/20 group-hover:shadow-glow">
                  <CardHeader>
                    <CardTitle className="transition-colors group-hover:text-emerald-300">
                      {demo.title}
                    </CardTitle>
                    <CardDescription>{demo.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Badge tone="accent">
                      <User className="h-3 w-3" />
                      {demo.author}
                    </Badge>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </Container>
    </main>
  );
}
