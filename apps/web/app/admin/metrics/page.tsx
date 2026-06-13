import SignupChart from "@/components/SignupChart";
import { signupsByDay } from "@/lib/admin";

export default async function AdminMetricsPage() {
  const data = await signupsByDay();
  const totalUsers = data.reduce((sum, d) => sum + d.count, 0);

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold">Signups</h2>
      <p className="mb-4 text-sm text-gray-600">
        Total users: <span className="font-medium text-gray-900">{totalUsers}</span>
      </p>
      <SignupChart data={data} />
    </section>
  );
}
