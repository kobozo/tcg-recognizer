const INFERENCE_URL = process.env.INFERENCE_URL ?? "http://inference:8001";
export async function predictCard(
  image: Blob,
  game = "pokemon",
  embedding?: number[],
): Promise<unknown> {
  const form = new FormData();
  form.append("image", image, "card.jpg");
  form.append("game", game);
  // On-device path: a precomputed embedding (computed in the browser) means the
  // model ran on the user's device; the server just does the pgvector lookup.
  if (embedding && embedding.length > 0) {
    form.append("embedding", JSON.stringify(embedding));
  }
  const r = await fetch(`${INFERENCE_URL}/predict`, { method: "POST", body: form });
  if (!r.ok) throw new Error(`inference ${r.status}`);
  return r.json();
}
