// TEST_OVERVIEW: Who may open an Environment is for people alone. A key bound to the Owning Agent — which the agent itself may hold — is refused reading and setting the agent's Environment Members, setting one Environment's members and listing every Environment, before the environments service is reached; the owner's own session reads them.
import { describe, expect, it, vi } from "vitest";
import type { ApiContext } from "api-server-api";
import { appRouter } from "api-server-api/router";
import { markTermsProven } from "api-server-api/trpc";
import { callerContext } from "../helpers/caller-context.js";

type User = ApiContext["user"];

const principal = (agentIds: User["agentIds"]): User => ({
  sub: "owner-1",
  preferredUsername: "owner",
  scopes: ["agents:manage", "agents:read"],
  agentIds,
});

function setup(user: User) {
  const environments = {
    agentMembers: vi.fn(async () => ["reviewer@example.com"]),
    setAgentMembers: vi.fn(async () => {}),
    setMembers: vi.fn(async () => {}),
    listAll: vi.fn(async () => []),
  };
  const ctx = callerContext({ environments, user });
  markTermsProven(ctx);
  return { caller: appRouter.createCaller(ctx), environments };
}

describe("who may open an Environment", () => {
  // TEST_SCENARIO: a key bound to the Owning Agent cannot read or set either list, nor list the owner's Environments, and the service is never reached.
  it("refuses a key bound to the Owning Agent", async () => {
    const { caller, environments } = setup(principal(["agent-owning"]));

    await expect(
      caller.environments.agentMembers({ owningAgentId: "agent-owning" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.environments.setAgentMembers({
        owningAgentId: "agent-owning",
        emails: ["someone@example.com"],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.environments.setMembers({
        id: "agent-env",
        emails: ["someone@example.com"],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.environments.listAll()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(environments.agentMembers).not.toHaveBeenCalled();
    expect(environments.setAgentMembers).not.toHaveBeenCalled();
    expect(environments.setMembers).not.toHaveBeenCalled();
    expect(environments.listAll).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the owner's own session reads the list.
  it("lets the owner read it", async () => {
    const { caller } = setup(principal("*"));

    expect(
      await caller.environments.agentMembers({ owningAgentId: "agent-owning" }),
    ).toEqual(["reviewer@example.com"]);
  });
});
