import { db } from "@/lib/db";
import { getGameMeta, getProvider, normalizeSetName } from "@/lib/games";
import { formatMoney, formatTotals } from "@/lib/format";
import type { CardPredictions, Enrichment } from "@/lib/types";
import { chatRouted, getProvider as getLlmProvider, NoProviderError } from "@/lib/llm/router";

export function assistantConfigured(): boolean {
  // Configured when any LLM backend (Claude or a default-on Ollama) is usable.
  return getLlmProvider() !== undefined;
}

type Stored = CardPredictions & { enrichment?: Enrichment | null };

/** Compact, token-bounded text summary of a user's collection for the LLM. */
export async function buildCollectionContext(userId: string): Promise<string> {
  const rows = await db.scan.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  if (rows.length === 0) return "The collection is currently empty.";

  const gameName = (id: string) => getGameMeta(id)?.name ?? id;

  // Official set totals per game present (for completion).
  const games = [...new Set(rows.map((r) => r.game))];
  const totals = new Map<string, number>();
  await Promise.all(
    games.map(async (g) => {
      const p = getProvider(g);
      if (!p) return;
      for (const s of await p.listSets()) totals.set(`${g}:${normalizeSetName(s.name)}`, s.total);
    }),
  );

  type SetAgg = { game: string; set: string; owned: number; value: number; currency?: string };
  const bySet = new Map<string, SetAgg>();
  const priced: { price?: number; currency?: string }[] = [];

  for (const r of rows) {
    const p = r.predictions as unknown as Stored;
    const set = p?.set?.value || "Unknown set";
    const key = `${r.game}:${set}`;
    const cur = bySet.get(key) ?? { game: r.game, set, owned: 0, value: 0 };
    cur.owned += 1;
    const price = p?.enrichment?.price;
    if (typeof price === "number" && price > 0) {
      cur.value += price;
      cur.currency = cur.currency ?? p?.enrichment?.currency;
    }
    bySet.set(key, cur);
    priced.push({ price: p?.enrichment?.price, currency: p?.enrichment?.currency });
  }

  const lines: string[] = [];
  lines.push(`Total cards: ${rows.length}`);
  lines.push(`Total estimated value: ${formatTotals(priced)}`);
  lines.push(`Games: ${games.map(gameName).join(", ")}`);
  lines.push("");
  lines.push("Set completion (game · set: owned/total, value):");
  for (const s of [...bySet.values()].sort((a, b) => b.value - a.value)) {
    const total = totals.get(`${s.game}:${normalizeSetName(s.set)}`) ?? 0;
    const val = s.value > 0 ? `, ${formatMoney(s.value, s.currency)}` : "";
    lines.push(`- ${gameName(s.game)} · ${s.set}: ${s.owned}${total ? `/${total}` : ""}${val}`);
  }

  // A sample of recent cards (bounded to keep the prompt small).
  lines.push("");
  lines.push("Recent cards (up to 60):");
  for (const r of rows.slice(0, 60)) {
    const p = r.predictions as unknown as Stored;
    const price =
      typeof p?.enrichment?.price === "number"
        ? ` ${formatMoney(p.enrichment.price, p.enrichment.currency)}`
        : "";
    lines.push(
      `- ${gameName(r.game)} | ${p?.name?.value ?? "?"} | ${p?.set?.value ?? "?"} | ${p?.rarity?.value ?? "?"}${price}`,
    );
  }

  return lines.join("\n");
}

export async function askAssistant(
  userId: string,
  question: string,
): Promise<{ answer?: string; error?: string }> {
  const NOT_CONFIGURED =
    "The AI assistant isn't configured yet. Add ANTHROPIC_API_KEY to .env (Claude), " +
    "or run the local Ollama model (docker compose --profile llm up -d ollama), to enable it.";

  if (!assistantConfigured()) {
    return { error: NOT_CONFIGURED };
  }
  try {
    const context = await buildCollectionContext(userId);
    const system =
      "You are a knowledgeable trading-card collection assistant for a Pokémon/Magic card recognizer app. " +
      "Answer the user's questions about THEIR collection using only the data provided below. " +
      "Be concise and practical — completion gaps, total/per-set value, what to chase or consider selling. " +
      "Prices are point-in-time snapshots in the listed currency (the user is in Belgium → EUR). " +
      "If the data is insufficient to answer, say so plainly. " +
      "Respond directly with your final answer; do not include exploratory reasoning.\n\n" +
      "=== USER'S COLLECTION ===\n" +
      context;

    const answer = await chatRouted(
      [
        { role: "system", content: system },
        { role: "user", content: question },
      ],
      { maxTokens: 1500 },
    );
    return { answer: answer || "(The assistant returned no text.)" };
  } catch (e) {
    // No usable backend at all → fall back to the inert "not configured" message.
    if (e instanceof NoProviderError) return { error: NOT_CONFIGURED };
    return {
      error:
        e instanceof Error
          ? `The assistant request failed: ${e.message}`
          : "The assistant request failed. Please try again.",
    };
  }
}
