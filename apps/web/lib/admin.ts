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

export type RecognitionHealth = {
  totalScans: number;
  avgConfidence: number | null; // 0..1
  lowConfidenceRate: number | null; // 0..1
  feedbackCount: number;
  corrections: number;
  needsRetraining: boolean;
};

/**
 * Drift / quality signal for the recognizer: average prediction confidence and
 * the share of low-confidence scans, plus the human-in-the-loop feedback volume.
 * A falling average confidence (or many corrections) is the cue to retrain.
 */
export async function recognitionHealth(): Promise<RecognitionHealth> {
  const [agg] = await db.$queryRaw<
    { total: number; avg_conf: number | null; low: number }[]
  >`
    SELECT count(*)::int AS total,
           avg((predictions->'name'->>'conf')::float) AS avg_conf,
           count(*) FILTER (WHERE (predictions->'name'->>'conf')::float < 0.6)::int AS low
    FROM "Scan"
    WHERE predictions->'name'->>'conf' IS NOT NULL
  `;
  const total = agg?.total ?? 0;
  const avg = agg?.avg_conf ?? null;
  const [feedbackCount, corrections] = await Promise.all([
    db.feedback.count(),
    db.feedback.count({ where: { correct: false } }),
  ]);
  return {
    totalScans: total,
    avgConfidence: avg,
    lowConfidenceRate: total > 0 ? (agg.low ?? 0) / total : null,
    feedbackCount,
    corrections,
    needsRetraining: avg !== null && avg < 0.6,
  };
}
