// TEST_OVERVIEW: The owner's list of people who may open an agent's Environments is the owner's alone. A key bound to the Owning Agent — which the agent itself may hold — is refused both reading and setting the list before the environments service is reached; the owner's own session reads and sets it.
import { describe, expect, it, vi } from "vitest";
import type { ApiContext } from "api-server-api";
import { appRouter } from "api-server-api/router";
import { markTermsProven } from "api-server-api/trpc";

type User = ApiContext["user"];

const principal = (agentIds: User["agentIds"]): User => ({
  sub: "owner-1",
  preferredUsername: "owner",
  scopes: ["agents:manage", "agents:read"],
  agentIds,
});

function setup(user: User) {
  const environments = {
    accessList: vi.fn(async () => ["reviewer@example.com"]),
    setAccessList: vi.fn(async () => {}),
  };
  const ctx = { environments, user } as unknown as ApiContext;
  markTermsProven(ctx);
  return { caller: appRouter.createCaller(ctx), environments };
}

describe("the owner's access list", () => {
  // TEST_SCENARIO: a key bound to the Owning Agent cannot read or set the owner's list, and the service is never reached.
  it("refuses a key bound to the Owning Agent", async () => {
    const { caller, environments } = setup(principal(["agent-owning"]));

    await expect(
      caller.environments.accessList({ owningAgentId: "agent-owning" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.environments.setAccessList({
        owningAgentId: "agent-owning",
        emails: ["someone@example.com"],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(environments.accessList).not.toHaveBeenCalled();
    expect(environments.setAccessList).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the owner's own session reads the list.
  it("lets the owner read it", async () => {
    const { caller } = setup(principal("*"));

    expect(
      await caller.environments.accessList({ owningAgentId: "agent-owning" }),
    ).toEqual(["reviewer@example.com"]);
  });
});
