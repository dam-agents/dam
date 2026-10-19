// TEST_OVERVIEW: Only the owner, signed in to the app, grants or removes a connection on an Environment. An API key — which an agent or a script may hold — is refused for an Environment before the connections service is reached, so an Owning Agent cannot pass its own connections to the software it runs; the same key still manages an ordinary agent's connections.
import { describe, expect, it, vi } from "vitest";
import type { ApiContext } from "api-server-api";
import { appRouter } from "api-server-api/router";
import { markTermsProven } from "api-server-api/trpc";

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
  const ctx = { connections, agents, user } as unknown as ApiContext;
  markTermsProven(ctx);
  return { caller: appRouter.createCaller(ctx), connections };
}

describe("connection grants on an Environment", () => {
  // TEST_SCENARIO: an API key cannot grant or remove a connection on an Environment, and the service is never reached.
  it("refuses an API key for an Environment", async () => {
    const { caller, connections } = setup(owner("key-1"));

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

  // TEST_SCENARIO: the owner in the app grants a connection on an Environment; an API key still manages an ordinary agent's connections as before.
  it("lets the owner in the app grant one, and keys keep ordinary agents", async () => {
    const inApp = setup(owner());
    await inApp.caller.connections.setAgentConnections({
      agentId: "agent-env",
      connectionIds: ["conn-1"],
    });
    expect(inApp.connections.setAgentConnections).toHaveBeenCalledWith(
      "agent-env",
      ["conn-1"],
    );

    const withKey = setup(owner("key-1"));
    await withKey.caller.connections.updateAgentConnections({
      agentId: "agent-owning",
      grant: ["conn-1"],
      revoke: [],
    });
    expect(withKey.connections.updateAgentConnections).toHaveBeenCalled();
  });
});
