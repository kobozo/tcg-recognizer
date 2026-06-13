import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * Server-side admin guard. Redirects non-admins (or anonymous visitors) to the
 * home page; otherwise returns the authenticated session. Admin data queries
 * must call this in addition to the route-level middleware check.
 */
export async function requireAdmin() {
  const s = await auth();
  if (!s || s.user.role !== "ADMIN") redirect("/");
  return s;
}

/** All users, newest first, with their scan counts. */
export function listUsers() {
  return db.user.findMany({
    include: { _count: { select: { scans: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export type SignupDay = { day: string; count: number };

/** Daily signup counts (Postgres date_trunc), ascending by day. */
export function signupsByDay(): Promise<SignupDay[]> {
  return db.$queryRaw<SignupDay[]>`
    SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
           count(*)::int AS count
    FROM "User"
    GROUP BY 1
    ORDER BY 1
  `;
}

/** All trained model versions, newest first. */
export function listModelVersions() {
  return db.modelVersion.findMany({ orderBy: { trainedAt: "desc" } });
}
