import Link from "next/link";
import { ArrowLeft, FlaskConical } from "lucide-react";
import Container from "@/components/ui/Container";
import Badge from "@/components/ui/Badge";

export default function DemoLayout({
  title,
  author,
  children,
}: {
  title: string;
  author: string;
  children: React.ReactNode;
}) {
  return (
    <main className="py-10">
      <Container className="max-w-3xl">
        <div className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-amber-200">
          <Badge tone="accent">
            <FlaskConical className="h-3 w-3" />
            Community demo
          </Badge>
          <span className="text-amber-200/90">
            contributed by{" "}
            <span className="font-medium text-amber-100">{author}</span>. These
            pages are made by classmates and are not part of the core app.
          </span>
        </div>
        <Link
          href="/demos"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to all demos
        </Link>
        <h1 className="mb-6 text-3xl font-bold tracking-tight sm:text-4xl">
          {title}
        </h1>
        <div className="prose prose-invert max-w-none text-muted">{children}</div>
      </Container>
    </main>
  );
}
