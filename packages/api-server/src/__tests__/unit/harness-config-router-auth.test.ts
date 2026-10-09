// TEST_OVERVIEW: The harnessConfig router refuses API keys that lack an agent scope, are bound to another agent, or try to change config without agents:manage, before the service is reached.
import { describe, expect, it, vi } from "vitest";
import type { ApiContext } from "api-server-api";
import { appRouter } from "api-server-api/router";
import { markTermsProven } from "api-server-api/trpc";

type User = ApiContext["user"];

const key = (
  scopes: User["scopes"],
  agentIds: User["agentIds"] = "*",
): User => ({
  sub: "owner-1",
  preferredUsername: "test",
  scopes,
  agentIds,
  keyId: "key-1",
});

function setup(user: User) {
  const harnessConfig = {
    status: vi.fn(async () => ({
      supported: true,
      catalog: null,
      sessionModel: false,
    })),
    settled: vi.fn(async () => ({ settled: true })),
    snapshot: vi.fn(async () => ({ hasRun: false, snapshot: null })),
    apply: vi.fn(async () => {}),
  };
  const ctx = { harnessConfig, user } as unknown as ApiContext;
  markTermsProven(ctx);
  return { caller: appRouter.createCaller(ctx), harnessConfig };
}

const reads = ["status", "settled", "snapshot"] as const;

describe("harnessConfig router authorization", () => {
  it.each(reads)("refuses %s to a key without an agent scope", async (op) => {
    const { caller, harnessConfig } = setup(key(["credentials:read"]));
    await expect(
      caller.harnessConfig[op]({ agentId: "agent-a" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(harnessConfig[op]).not.toHaveBeenCalled();
  });

  it.each(reads)(
    "refuses %s for an agent the key is not bound to",
    async (op) => {
      const { caller, harnessConfig } = setup(
        key(["agents:read"], ["agent-a"]),
      );
      await expect(
        caller.harnessConfig[op]({ agentId: "agent-b" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(harnessConfig[op]).not.toHaveBeenCalled();
    },
  );

  it.each(reads)("serves %s for the key's own agent", async (op) => {
    const { caller, harnessConfig } = setup(key(["agents:read"], ["agent-a"]));
    await caller.harnessConfig[op]({ agentId: "agent-a" });
    expect(harnessConfig[op]).toHaveBeenCalledWith("agent-a");
  });

  it.each([
    { label: "an agents:read key", user: key(["agents:read"]) },
    { label: "an agents:operate key", user: key(["agents:operate"]) },
    { label: "a credentials:read key", user: key(["credentials:read"]) },
    {
      label: "an agent-bound agents:manage key",
      user: key(["agents:manage"], ["agent-a"]),
    },
  ])("refuses set to $label", async ({ user }) => {
    const { caller, harnessConfig } = setup(user);
    await expect(
      caller.harnessConfig.set({ agentId: "agent-b", model: "m" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(harnessConfig.apply).not.toHaveBeenCalled();
  });

  it("applies set for a browser session", async () => {
    const { caller, harnessConfig } = setup({
      sub: "owner-1",
      preferredUsername: "test",
      scopes: ["agents:read", "agents:operate", "agents:manage"],
      agentIds: "*",
    });
    await caller.harnessConfig.set({ agentId: "agent-b", model: "m" });
    expect(harnessConfig.apply).toHaveBeenCalledWith("agent-b", { model: "m" });
  });
});
