import Link from "next/link";

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
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <span className="font-semibold">Community demo</span> — contributed by{" "}
        <span className="font-medium">{author}</span>. These pages are made by
        classmates and are not part of the core app.
      </div>
      <Link
        href="/demos"
        className="mb-6 inline-block text-sm text-blue-600 hover:underline"
      >
        ← Back to all demos
      </Link>
      <h1 className="mb-6 text-3xl font-bold tracking-tight">{title}</h1>
      <div className="prose max-w-none">{children}</div>
    </main>
  );
}
