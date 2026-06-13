import { describe, it, expect } from "vitest";
import { PrismaClient, Role } from "@prisma/client";

describe("Prisma schema", () => {
  it("instantiates a PrismaClient", () => {
    const client = new PrismaClient();
    expect(client).toBeDefined();
    expect(typeof client.$connect).toBe("function");
    expect(typeof client.$disconnect).toBe("function");
  });

  it("exposes user, session, scan, and modelVersion delegates", () => {
    const client = new PrismaClient();
    expect(client.user).toBeDefined();
    expect(client.session).toBeDefined();
    expect(client.scan).toBeDefined();
    expect(client.modelVersion).toBeDefined();
  });

  it("exposes the Role enum values", () => {
    expect(Role.USER).toBe("USER");
    expect(Role.ADMIN).toBe("ADMIN");
  });
});
