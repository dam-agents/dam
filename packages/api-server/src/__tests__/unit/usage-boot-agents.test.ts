// TEST_OVERVIEW: The boot pass that writes every Agent row must bind a chat default only for an Agent it restores from deletion. An Agent still waiting for its first hello keeps none, so its conversion can save the model it actually ran, and an Agent create deliberately left unbound stays unbound.
import { describe, expect, it } from "vitest";
import {
  upsertBootAgent,
  type BootAgentRow,
} from "../../modules/usage/compose.js";

const AGENT: BootAgentRow = {
  id: "agent-1",
  owner: "owner-1",
  starterKit: null,
  onboardedAt: null,
};

function setup(opts: { restored: boolean }) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      isRestoredAgent: async () => opts.restored,
      upsert: async (row: { id: string; ownerSub: string }) => {
        calls.push(`upsert:${row.id}:${row.ownerSub}`);
      },
      fillKitFacts: async () => {
        calls.push("kit-facts");
      },
      onAgentRestored: async (agentId: string) => {
        calls.push(`bind:${agentId}`);
      },
      log: () => {},
    },
  };
}

describe("the boot pass over Agent rows", () => {
  it("writes the row and binds it when it was restored from deletion", async () => {
    const { deps, calls } = setup({ restored: true });
    await upsertBootAgent(deps, AGENT);
    expect(calls).toEqual([
      "upsert:agent-1:owner-1",
      "kit-facts",
      "bind:agent-1",
    ]);
  });

  /** TEST_SCENARIO: an Agent that never had a default is not a restore; binding
   * it would move it to the seeded Default before its conversion runs. */
  it("leaves an Agent that was not restored on no default", async () => {
    const { deps, calls } = setup({ restored: false });
    await upsertBootAgent(deps, AGENT);
    expect(calls).toEqual(["upsert:agent-1:owner-1", "kit-facts"]);
  });

  it("keeps the row write when the binding fails", async () => {
    const { deps, calls } = setup({ restored: true });
    deps.onAgentRestored = async () => {
      throw new Error("boom");
    };
    await expect(upsertBootAgent(deps, AGENT)).resolves.toBeUndefined();
    expect(calls).toEqual(["upsert:agent-1:owner-1", "kit-facts"]);
  });
});
