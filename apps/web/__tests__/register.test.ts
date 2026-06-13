import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Prisma client singleton used by the register route.
const createMock = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      create: (...args: unknown[]) => createMock(...args),
    },
  },
}));

import { POST } from "../app/api/register/route";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/register", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("creates a user with a bcrypt-hashed password and returns 201", async () => {
    createMock.mockResolvedValue({
      id: "user_1",
      email: "new@example.com",
      role: "USER",
    });

    const res = await POST(makeRequest({ email: "new@example.com", password: "supersecret" }));

    expect(res.status).toBe(201);
    expect(createMock).toHaveBeenCalledTimes(1);

    const arg = createMock.mock.calls[0][0] as { data: { email: string; passwordHash: string } };
    const { passwordHash } = arg.data;

    // Password must be hashed, not stored as plaintext.
    expect(passwordHash).not.toBe("supersecret");
    // bcrypt hashes start with $2a$, $2b$ or $2y$.
    expect(passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
  });

  it("returns 409 when the email already exists (Prisma P2002)", async () => {
    createMock.mockRejectedValue({ code: "P2002" });

    const res = await POST(makeRequest({ email: "dup@example.com", password: "supersecret" }));

    expect(res.status).toBe(409);
  });

  it("returns 400 when the password is too weak", async () => {
    const res = await POST(makeRequest({ email: "weak@example.com", password: "short" }));

    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });
});
