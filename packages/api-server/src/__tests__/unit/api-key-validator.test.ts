import { describe, it, expect, vi } from "vitest";
import { createApiKeyValidator } from "../../modules/api-keys/services/api-key-validator.js";
import { hashApiKeyToken } from "../../modules/api-keys/domain/token.js";
import type { ApiKeyRow } from "../../modules/api-keys/domain/types.js";

function row(overrides: Partial<ApiKeyRow> = {}): ApiKeyRow {
  return {
    id: "key-deadbeef",
    ownerSub: "owner-1",
    name: "ci",
    hash: hashApiKeyToken("pk_xxx"),
    scopes: ["agents:operate"],
    agentIds: null,
    expiresAt: null,
    createdAt: new Date(),
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

describe("createApiKeyValidator", () => {
  it("returns ok with wildcard binding when agent_ids is null", async () => {
    const validate = createApiKeyValidator({
      findByHash: async () => row(),
      touchLastUsed: async () => {},
    });
    const r = await validate("pk_xxx");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.agentIds).toBe("*");
      expect(r.value.ownerSub).toBe("owner-1");
      expect(r.value.scopes).toEqual(["agents:operate"]);
    }
  });

  it("rejects unknown tokens", async () => {
    const validate = createApiKeyValidator({
      findByHash: async () => null,
      touchLastUsed: async () => {},
    });
    const r = await validate("pk_nope");
    expect(r).toEqual({ ok: false, error: "unknown" });
  });

  it("rejects revoked keys", async () => {
    const validate = createApiKeyValidator({
      findByHash: async () => row({ revokedAt: new Date() }),
      touchLastUsed: async () => {},
    });
    const r = await validate("pk_xxx");
    expect(r).toEqual({ ok: false, error: "revoked" });
  });

  it("rejects expired keys", async () => {
    const yesterday = new Date(Date.now() - 86_400_000);
    const validate = createApiKeyValidator({
      findByHash: async () => row({ expiresAt: yesterday }),
      touchLastUsed: async () => {},
    });
    const r = await validate("pk_xxx");
    expect(r).toEqual({ ok: false, error: "expired" });
  });

  it("preserves the agent allowlist when not null", async () => {
    const validate = createApiKeyValidator({
      findByHash: async () => row({ agentIds: ["agent-1", "agent-2"] }),
      touchLastUsed: async () => {},
    });
    const r = await validate("pk_xxx");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.agentIds).toEqual(["agent-1", "agent-2"]);
  });

  it("touches last_used_at on success (fire-and-forget)", async () => {
    const touch = vi.fn().mockResolvedValue(undefined);
    const validate = createApiKeyValidator({
      findByHash: async () => row(),
      touchLastUsed: touch,
    });
    await validate("pk_xxx");
    // The touch is fire-and-forget — give it a microtask to settle.
    await new Promise((r) => setImmediate(r));
    expect(touch).toHaveBeenCalledWith("key-deadbeef");
  });

  it("does NOT fail the request when touchLastUsed throws", async () => {
    const validate = createApiKeyValidator({
      findByHash: async () => row(),
      touchLastUsed: async () => {
        throw new Error("db down");
      },
    });
    const r = await validate("pk_xxx");
    expect(r.ok).toBe(true);
  });
});
