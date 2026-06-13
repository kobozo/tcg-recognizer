import { describe, it, expect, vi, beforeEach } from "vitest";

const authMock = vi.fn();
const redirectMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: (...args: unknown[]) => authMock(...args),
}));

vi.mock("@/lib/db", () => ({
  db: {},
}));

vi.mock("next/navigation", () => ({
  // Mimic the real redirect() which throws to halt execution.
  redirect: (...args: unknown[]) => {
    redirectMock(...args);
    throw new Error("NEXT_REDIRECT");
  },
}));

import { requireAdmin } from "../lib/admin";

describe("requireAdmin()", () => {
  beforeEach(() => {
    authMock.mockReset();
    redirectMock.mockReset();
  });

  it("redirects to / when there is no session", async () => {
    authMock.mockResolvedValue(null);

    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  it("redirects to / when the user is not an admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "USER" } });

    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  it("returns the session when the user is an admin", async () => {
    const session = { user: { id: "u1", role: "ADMIN" } };
    authMock.mockResolvedValue(session);

    const result = await requireAdmin();

    expect(result).toBe(session);
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
