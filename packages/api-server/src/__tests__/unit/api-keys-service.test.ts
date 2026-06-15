import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import type { Scope } from "api-server-api";
import { createApiKeysService } from "../../modules/api-keys/services/api-keys-service.js";
import type { ApiKeyRow } from "../../modules/api-keys/domain/types.js";

interface InsertArgs {
  id: string;
  ownerSub: string;
  name: string;
  hash: string;
  scopes: readonly Scope[];
  agentIds: readonly string[] | null;
  expiresAt: Date | null;
}

interface FakeRepo {
  store: Map<string, ApiKeyRow>;
  list: (owner: string) => Promise<ApiKeyRow[]>;
  insert: (row: InsertArgs) => Promise<ApiKeyRow>;
  revoke: (id: string, owner: string) => Promise<boolean>;
}

function fakeRepo(): FakeRepo {
  const store = new Map<string, ApiKeyRow>();
  return {
    store,
    list: async (owner) =>
      Array.from(store.values()).filter(
        (r) => r.ownerSub === owner && !r.revokedAt,
      ),
    insert: async (row) => {
      const persisted: ApiKeyRow = {
        ...row,
        createdAt: new Date(),
        lastUsedAt: null,
        revokedAt: null,
      };
      store.set(persisted.id, persisted);
      return persisted;
    },
    revoke: async (id, owner) => {
      const row = store.get(id);
      if (!row || row.ownerSub !== owner || row.revokedAt) return false;
      store.set(id, { ...row, revokedAt: new Date() });
      return true;
    },
  };
}

interface ServiceFixture {
  svc: ReturnType<typeof createApiKeysService>;
  repo: FakeRepo;
}

function createService(
  opts: {
    callerKeyId?: string;
    isAgentOwnedBy?: (agentId: string, ownerSub: string) => Promise<boolean>;
  } = {},
): ServiceFixture {
  const repo = fakeRepo();
  const svc = createApiKeysService({
    ownerSub: "owner-1",
    callerKeyId: opts.callerKeyId,
    list: repo.list,
    insert: repo.insert,
    revoke: repo.revoke,
    isAgentOwnedBy: opts.isAgentOwnedBy ?? (async () => true),
  });
  return { svc, repo };
}

describe("ApiKeysService", () => {
  it("create returns plaintext once + a view without secret material", async () => {
    const { svc } = createService();
    const result = await svc.create({
      name: "ci",
      scopes: ["agents:operate"],
      agentIds: "*",
    });
    expect(result.plaintext.startsWith("pk_")).toBe(true);
    expect(result.key.name).toBe("ci");
    expect(result.key.agentIds).toBe("*");
    expect(result.key.scopes).toEqual(["agents:operate"]);
    expect((result.key as unknown as { hash?: string }).hash).toBeUndefined();
    expect(
      (result.key as unknown as { plaintext?: string }).plaintext,
    ).toBeUndefined();
  });

  it("list returns only the current owner's non-revoked keys", async () => {
    const { svc } = createService();
    await svc.create({ name: "k1", scopes: ["agents:operate"], agentIds: "*" });
    const { key: k2 } = await svc.create({
      name: "k2",
      scopes: ["agents:operate"],
      agentIds: "*",
    });
    await svc.revoke(k2.id);
    const listed = await svc.list();
    expect(listed.map((k) => k.name)).toEqual(["k1"]);
  });

  it("revoke throws NOT_FOUND for unknown ids", async () => {
    const { svc } = createService();
    await expect(svc.revoke("key-nope")).rejects.toThrow(TRPCError);
  });

  describe("API keys cannot manage API keys", () => {
    it("list rejects when caller authenticated via an api-key", async () => {
      const { svc } = createService({ callerKeyId: "key-some" });
      await expect(svc.list()).rejects.toThrow(TRPCError);
    });

    it("create rejects when caller authenticated via an api-key", async () => {
      const { svc } = createService({ callerKeyId: "key-some" });
      await expect(
        svc.create({ name: "x", scopes: ["agents:operate"], agentIds: "*" }),
      ).rejects.toThrow(TRPCError);
    });

    it("revoke rejects when caller authenticated via an api-key", async () => {
      const { svc, repo } = createService();
      const { key } = await svc.create({
        name: "x",
        scopes: ["agents:operate"],
        agentIds: "*",
      });
      const svc2 = createApiKeysService({
        ownerSub: "owner-1",
        callerKeyId: "key-other",
        list: repo.list,
        insert: repo.insert,
        revoke: repo.revoke,
        isAgentOwnedBy: async () => true,
      });
      await expect(svc2.revoke(key.id)).rejects.toThrow(TRPCError);
    });
  });

  describe("agent binding validation", () => {
    it("rejects creating a key bound to a non-owned agent", async () => {
      const { svc } = createService({
        isAgentOwnedBy: async (id) => id === "agent-mine",
      });
      await expect(
        svc.create({
          name: "x",
          scopes: ["agents:operate"],
          agentIds: ["agent-yours"],
        }),
      ).rejects.toThrow(TRPCError);
    });

    it("accepts a key bound to an owned agent", async () => {
      const { svc } = createService({
        isAgentOwnedBy: async (id) => id === "agent-mine",
      });
      const result = await svc.create({
        name: "x",
        scopes: ["agents:operate"],
        agentIds: ["agent-mine"],
      });
      expect(result.key.agentIds).toEqual(["agent-mine"]);
    });

    it("rejects an agents:manage key bound to a specific agent", async () => {
      const { svc } = createService();
      await expect(
        svc.create({
          name: "x",
          scopes: ["agents:manage"],
          agentIds: ["agent-mine"],
        }),
      ).rejects.toThrow(TRPCError);
    });

    it("accepts an agents:manage key with wildcard binding", async () => {
      const { svc } = createService();
      const result = await svc.create({
        name: "x",
        scopes: ["agents:manage"],
        agentIds: "*",
      });
      expect(result.key.scopes).toEqual(["agents:manage"]);
    });
  });

  it("rejects expiresAt in the past", async () => {
    const { svc } = createService();
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    await expect(
      svc.create({
        name: "x",
        scopes: ["agents:operate"],
        agentIds: "*",
        expiresAt: yesterday,
      }),
    ).rejects.toThrow(TRPCError);
  });
});
