import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, type User } from "@/lib/db";
import {
  authenticateToken,
  createToken,
  resolveAgentSource,
  revokeToken,
} from "@/services/tokens";

let user: User;
const marker = `t11_${Date.now()}`;

beforeAll(async () => {
  user = await db.user.create({ data: { clerkId: `${marker}_user` } });
});

afterAll(async () => {
  await db.apiToken.deleteMany({ where: { userId: user.id } });
  await db.user.deleteMany({ where: { clerkId: { startsWith: marker } } });
});

describe("api tokens (T11: D35 pattern)", () => {
  it("creates a token that authenticates as the owning user", async () => {
    const { token } = await createToken(user.id, "test agent");
    const auth = await authenticateToken(token);
    expect(auth?.user.id).toBe(user.id);
    expect(auth?.token.lastUsedAt).not.toBeNull();
  });

  it("stores only a hash — the full value is never recoverable", async () => {
    const { token, record } = await createToken(user.id, "hash check");
    expect(record.hash).not.toContain(token);
    expect(
      await db.apiToken.findUnique({ where: { prefix: record.prefix } })
    ).toHaveProperty("hash", expect.not.stringContaining("gldos_"));
  });

  it("rejects tampered and unknown tokens", async () => {
    const { token } = await createToken(user.id, "tamper check");
    expect(await authenticateToken(token.slice(0, -2) + "xx")).toBeNull();
    expect(await authenticateToken("gldos_nope_nope")).toBeNull();
  });

  it("revocation takes effect immediately", async () => {
    const { token, record } = await createToken(user.id, "revoked");
    await revokeToken(user.id, record.id);
    expect(await authenticateToken(token)).toBeNull();
  });

  it("token requests may only declare agent sources — never web/system (D35)", () => {
    expect(resolveAgentSource("agent_plugin")).toBe("agent_plugin");
    expect(resolveAgentSource("extension")).toBe("extension");
    expect(() => resolveAgentSource("web")).toThrow("agent_plugin | extension");
    expect(() => resolveAgentSource("system")).toThrow(
      "agent_plugin | extension"
    );
    expect(() => resolveAgentSource(undefined)).toThrow();
  });
});
