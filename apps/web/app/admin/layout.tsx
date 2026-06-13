import Link from "next/link";
import { Users, BarChart3, Cpu } from "lucide-react";
import { requireAdmin } from "@/lib/admin";
import Container from "@/components/ui/Container";

const navItems = [
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/metrics", label: "Metrics", icon: BarChart3 },
  { href: "/admin/mlops", label: "MLOps", icon: Cpu },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();

  return (
    <Container className="py-8 sm:py-10">
      <div className="animate-fade-up">
        <h1 className="mb-5 text-2xl font-semibold tracking-tight sm:text-3xl">Admin</h1>
        <nav className="mb-8 flex gap-2 border-b border-border pb-3 text-sm">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 font-medium text-muted transition-colors hover:bg-white/5 hover:text-foreground"
            >
              <Icon className="h-4 w-4" aria-hidden /> {label}
            </Link>
          ))}
        </nav>
        {children}
      </div>
    </Container>
  );
}
