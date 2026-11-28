// TEST_OVERVIEW: who may set an agent's own scope on its grant. Only a person signed in as the connection's owner: an API key, and so an agent that holds the platform connection's key, is refused before the service runs, so an agent can never change its own access.
import { describe, expect, it, vi } from "vitest";
import type { ApiContext } from "api-server-api";
import { appRouter } from "api-server-api/router";
import { markTermsProven } from "api-server-api/trpc";
import { callerContext } from "../helpers/caller-context.js";

type User = ApiContext["user"];

const INPUT = {
  agentId: "agent-1",
  connectionId: "conn-dam",
  scope: { kind: "platform", reach: "own" },
} as const;

function setup(user: User) {
  const connections = { setGrantScope: vi.fn(async () => {}) };
  const ctx = callerContext({ connections, user });
  markTermsProven(ctx);
  return { caller: appRouter.createCaller(ctx), connections };
}

describe("setting an agent's own scope", () => {
  // TEST_SCENARIO: the owner, signed in, sets the scope. The input reaches the service as given.
  it("lets the signed-in owner set it", async () => {
    const { caller, connections } = setup({
      sub: "owner-1",
      preferredUsername: "owner",
      scopes: ["agents:manage", "credentials:manage"],
      agentIds: "*",
    });
    await caller.connections.setGrantScope(INPUT);
    expect(connections.setGrantScope).toHaveBeenCalledWith(INPUT);
  });

  // TEST_SCENARIO: the platform connection's own key holds every scope a person's key has. An agent that holds it is still refused, as is any API key and an agent's own key.
  it.each<[string, User]>([
    [
      "the platform connection's owner key",
      {
        sub: "owner-1",
        preferredUsername: "owner-1",
        scopes: ["agents:manage", "credentials:manage"],
        agentIds: "*",
        keyId: "key-1",
      },
    ],
    [
      "an agent's own key",
      {
        sub: "owner-1",
        preferredUsername: "owner-1",
        scopes: ["agents:read"],
        agentIds: ["agent-1"],
        keyId: "key-2",
        actingAgent: "agent-1",
      },
    ],
  ])("refuses %s", async (_name, user) => {
    const { caller, connections } = setup(user);
    await expect(caller.connections.setGrantScope(INPUT)).rejects.toMatchObject(
      {
        code: "FORBIDDEN",
      },
    );
    expect(connections.setGrantScope).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the scope's shape is checked before the service runs: an unknown kind or reach, or an extra field, is refused.
  it("refuses a scope of an unknown shape", async () => {
    const { caller, connections } = setup({
      sub: "owner-1",
      preferredUsername: "owner",
      scopes: ["agents:manage"],
      agentIds: "*",
    });
    await expect(
      caller.connections.setGrantScope({
        ...INPUT,
        scope: { kind: "platform", reach: "all" } as never,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.connections.setGrantScope({
        ...INPUT,
        scope: { kind: "platform", reach: "own", extra: 1 } as never,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(connections.setGrantScope).not.toHaveBeenCalled();
  });
});
