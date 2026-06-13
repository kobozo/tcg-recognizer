import { Users, CalendarDays } from "lucide-react";
import SignupChart from "@/components/SignupChart";
import { signupsByDay } from "@/lib/admin";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";

export default async function AdminMetricsPage() {
  const data = await signupsByDay();
  const totalUsers = data.reduce((sum, d) => sum + d.count, 0);

  const stats = [
    { label: "Total users", value: totalUsers, icon: Users },
    { label: "Days with signups", value: data.length, icon: CalendarDays },
  ];

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold tracking-tight">Signups</h2>

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        {stats.map(({ label, value, icon: Icon }) => (
          <Card key={label} className="flex items-center gap-4 p-5">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/5 text-accent">
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <p className="text-sm text-muted">{label}</p>
              <p className="text-2xl font-semibold tracking-tight text-foreground">
                {value}
              </p>
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Signups over time</CardTitle>
        </CardHeader>
        <CardContent>
          <SignupChart data={data} />
        </CardContent>
      </Card>
    </section>
  );
}
