import Link from "next/link";
import { requireAdmin } from "@/lib/admin";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="mb-4 text-2xl font-bold">Admin</h1>
      <nav className="mb-6 flex gap-4 border-b border-gray-200 pb-3 text-sm">
        <Link href="/admin/users" className="text-gray-700 hover:text-blue-600">
          Users
        </Link>
        <Link href="/admin/metrics" className="text-gray-700 hover:text-blue-600">
          Metrics
        </Link>
        <Link href="/admin/mlops" className="text-gray-700 hover:text-blue-600">
          MLOps
        </Link>
      </nav>
      {children}
    </div>
  );
}
