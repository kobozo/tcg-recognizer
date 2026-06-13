import { listUsers } from "@/lib/admin";

export default async function AdminUsersPage() {
  const users = await listUsers();

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold">Users ({users.length})</h2>
      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Joined</th>
              <th className="px-4 py-2 font-medium"># Scans</th>
              <th className="px-4 py-2 font-medium">Role</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-2">{u.email}</td>
                <td className="px-4 py-2 text-gray-600">
                  {new Date(u.createdAt).toISOString().slice(0, 10)}
                </td>
                <td className="px-4 py-2">{u._count.scans}</td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      u.role === "ADMIN"
                        ? "bg-purple-100 text-purple-700"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {u.role}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
