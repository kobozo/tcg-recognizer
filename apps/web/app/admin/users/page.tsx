import { listUsers } from "@/lib/admin";
import { Card } from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";

export default async function AdminUsersPage() {
  const users = await listUsers();

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold tracking-tight">Users ({users.length})</h2>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left">
            <tr className="border-b border-border">
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
                Email
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
                Joined
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
                # Scans
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
                Role
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 text-foreground">{u.email}</td>
                <td className="px-4 py-3 text-muted">
                  {new Date(u.createdAt).toISOString().slice(0, 10)}
                </td>
                <td className="px-4 py-3 text-foreground">{u._count.scans}</td>
                <td className="px-4 py-3">
                  <Badge tone={u.role === "ADMIN" ? "accent" : "neutral"}>
                    {u.role}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </section>
  );
}
