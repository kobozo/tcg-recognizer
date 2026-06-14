import { describe, it, expect, vi, beforeEach } from "vitest";

const authMock = vi.fn();
const predictCardMock = vi.fn();
const scanCreateMock = vi.fn();
const enrichCardMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: (...args: unknown[]) => authMock(...args),
}));

vi.mock("@/lib/inference", () => ({
  predictCard: (...args: unknown[]) => predictCardMock(...args),
}));

vi.mock("@/lib/enrich", () => ({
  enrichCard: (...args: unknown[]) => enrichCardMock(...args),
}));

vi.mock("@/lib/db", () => ({
  db: {
    scan: {
      create: (...args: unknown[]) => scanCreateMock(...args),
    },
  },
}));

// Avoid touching the real filesystem during the test.
vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from "../app/api/scan/route";

const PREDICTIONS = {
  name: { value: "Pikachu", conf: 0.95 },
  type: { value: "Lightning", conf: 0.9 },
  set: { value: "Base", conf: 0.8 },
  rarity: { value: "Common", conf: 0.7 },
  card_number: { value: "58/102", conf: 0.6 },
  model_version: "stub-1",
};

function makeImageRequest(): Request {
  const form = new FormData();
  const file = new File([new Uint8Array([1, 2, 3])], "card.jpg", { type: "image/jpeg" });
  form.append("image", file);
  return new Request("http://localhost/api/scan", { method: "POST", body: form });
}

describe("POST /api/scan", () => {
  beforeEach(() => {
    authMock.mockReset();
    predictCardMock.mockReset();
    scanCreateMock.mockReset();
    enrichCardMock.mockReset();
  });

  it("returns 401 when unauthenticated", async () => {
    authMock.mockResolvedValue(null);

    const res = await POST(makeImageRequest());

    expect(res.status).toBe(401);
    expect(predictCardMock).not.toHaveBeenCalled();
    expect(scanCreateMock).not.toHaveBeenCalled();
  });

  it("returns 400 when no image is provided", async () => {
    authMock.mockResolvedValue({ user: { id: "user_1" } });

    const form = new FormData();
    const req = new Request("http://localhost/api/scan", { method: "POST", body: form });

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(predictCardMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the uploaded file is not an image", async () => {
    authMock.mockResolvedValue({ user: { id: "user_1" } });

    const form = new FormData();
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    form.append("image", file);
    const req = new Request("http://localhost/api/scan", { method: "POST", body: form });

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(predictCardMock).not.toHaveBeenCalled();
  });

  it("predicts, persists and returns { id } with 201 when authenticated", async () => {
    authMock.mockResolvedValue({ user: { id: "user_1" } });
    predictCardMock.mockResolvedValue(PREDICTIONS);
    enrichCardMock.mockResolvedValue({ hp: "60" });
    scanCreateMock.mockResolvedValue({ id: "scan_1" });

    const res = await POST(makeImageRequest());
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.id).toBe("scan_1");

    expect(predictCardMock).toHaveBeenCalledTimes(1);
    expect(enrichCardMock).toHaveBeenCalledWith("Pikachu", "pokemon");

    expect(scanCreateMock).toHaveBeenCalledTimes(1);
    const arg = scanCreateMock.mock.calls[0][0] as {
      data: {
        userId: string;
        imagePath: string;
        predictions: Record<string, unknown>;
        modelVersion: string;
      };
    };
    expect(arg.data.userId).toBe("user_1");
    expect(arg.data.modelVersion).toBe("stub-1");
    expect(arg.data.imagePath).toMatch(/\/app\/uploads\/.+\.jpg$/);
    expect(arg.data.predictions).toMatchObject({
      name: { value: "Pikachu" },
      enrichment: { hp: "60" },
    });
  });

  it("still persists when enrichment returns null (best-effort)", async () => {
    authMock.mockResolvedValue({ user: { id: "user_1" } });
    predictCardMock.mockResolvedValue(PREDICTIONS);
    enrichCardMock.mockResolvedValue(null);
    scanCreateMock.mockResolvedValue({ id: "scan_2" });

    const res = await POST(makeImageRequest());
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.id).toBe("scan_2");
  });
});
