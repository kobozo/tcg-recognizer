import Link from "next/link";
import Logo from "@/components/Logo";

export default function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-muted sm:flex-row sm:px-6">
        <Logo />
        <p>Built for the Erasmus AI project · Pokémon card recognition</p>
        <nav className="flex items-center gap-4">
          <Link href="/scan" className="hover:text-foreground">
            Scan
          </Link>
          <Link href="/demos" className="hover:text-foreground">
            Demos
          </Link>
        </nav>
      </div>
    </footer>
  );
}
