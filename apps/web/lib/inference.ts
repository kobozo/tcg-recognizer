const INFERENCE_URL = process.env.INFERENCE_URL ?? "http://inference:8001";
export async function predictCard(image: Blob): Promise<unknown> {
  const form = new FormData();
  form.append("image", image, "card.jpg");
  const r = await fetch(`${INFERENCE_URL}/predict`, { method: "POST", body: form });
  if (!r.ok) throw new Error(`inference ${r.status}`);
  return r.json();
}
