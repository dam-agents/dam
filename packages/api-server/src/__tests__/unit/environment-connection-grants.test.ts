// TEST_OVERVIEW: An Environment holds no connections. A grant or removal on one is refused for every caller — an API key, which an agent or a script may hold, and the owner's own session alike — before the connections service is reached, so an Owning Agent cannot pass its own connections to the software it runs; the same callers still manage an ordinary agent's connections.
import { describe, expect, it, vi } from "vitest";
import type { ApiContext } from "api-server-api";
import { appRouter } from "api-server-api/router";
import { markTermsProven } from "api-server-api/trpc";
import { callerContext } from "../helpers/caller-context.js";

type User = ApiContext["user"];

const owner = (keyId?: string): User => ({
  sub: "owner-1",
  preferredUsername: "owner",
  scopes: ["agents:manage", "agents:read"],
  agentIds: "*",
  ...(keyId ? { keyId } : {}),
});

function setup(user: User) {
  const connections = {
    setAgentConnections: vi.fn(async () => {}),
    updateAgentConnections: vi.fn(async () => {}),
  };
  const agents = {
    get: async (id: string) =>
      ({
        id,
        spec: id === "agent-env" ? { environmentOf: "agent-owning" } : {},
      }) as never,
  };
  const ctx = callerContext({ connections, agents, user });
  markTermsProven(ctx);
  return { caller: appRouter.createCaller(ctx), connections };
}

describe("connection grants on an Environment", () => {
  // TEST_SCENARIO: neither an API key nor the owner's session can grant or remove a connection on an Environment, and the service is never reached.
  it.each([
    ["an API key", "key-1"],
    ["the owner's session", undefined],
  ])("refuses %s for an Environment", async (_who, keyId) => {
    const { caller, connections } = setup(owner(keyId));

    await expect(
      caller.connections.setAgentConnections({
        agentId: "agent-env",
        connectionIds: ["conn-1"],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.connections.updateAgentConnections({
        agentId: "agent-env",
        grant: ["conn-1"],
        revoke: [],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(connections.setAgentConnections).not.toHaveBeenCalled();
    expect(connections.updateAgentConnections).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: an API key still manages an ordinary agent's connections as before.
  it("keeps keys managing ordinary agents", async () => {
    const withKey = setup(owner("key-1"));
    await withKey.caller.connections.updateAgentConnections({
      agentId: "agent-owning",
      grant: ["conn-1"],
      revoke: [],
    });
    expect(withKey.connections.updateAgentConnections).toHaveBeenCalled();
  });
});
