// TEST_OVERVIEW: the gate that refuses a Size which could never run, as distinct from one that cannot run yet. Two different things make a Size impossible — a budget ceiling and the size of the machines — and they need different answers from the user, so both are checked where the Size is chosen rather than left to a scheduler that would decline to place it silently and for ever.
import { describe, expect, it } from "vitest";
import { createSpawnSizeGate } from "../../modules/budgets/services/budgets-service.js";

const gate = (largest: number | null) =>
  createSpawnSizeGate({
    readCeilingOverride: async () => null,
    defaultCeiling: { cpu: "16", memory: "32Gi" },
    largestNodeMemoryBytes: async () => largest,
  });

describe("a size that could never run", () => {
  it("names the budget when the budget is what it exceeds", async () => {
    await expect(
      gate(64 * 1024 ** 3).assertCanEverFit({ cpu: "2", memory: "64Gi" }),
    ).rejects.toThrow(/budget ceiling/);
  });

  // TEST_SCENARIO: a Size inside the owner's budget but larger than any node's memory. The budget gate passes it and the scheduler then declines to place it for ever, which reads to the user as an agent that simply never starts.
  it("names the node when the machines are what it exceeds", async () => {
    await expect(
      gate(8 * 1024 ** 3).assertCanEverFit({ cpu: "2", memory: "16Gi" }),
    ).rejects.toThrow(/largest node in this install has 8\.0Gi/);
  });

  it("allows a size the largest node can hold", async () => {
    await expect(
      gate(8 * 1024 ** 3).assertCanEverFit({ cpu: "2", memory: "4Gi" }),
    ).resolves.toBeUndefined();
  });

  // TEST_SCENARIO: an install whose nodes have not registered yet. Refusing every Size because the registry is momentarily empty would be worse than letting the agent wait for a node to appear.
  it("does not refuse when there is no node to compare against", async () => {
    await expect(
      gate(null).assertCanEverFit({ cpu: "2", memory: "16Gi" }),
    ).resolves.toBeUndefined();
  });

  // TEST_SCENARIO: CPU. A share is a weight on a contended node rather than a reservation, so no node is ever too small to accept one.
  it("never refuses a CPU share for being larger than a node", async () => {
    await expect(
      gate(8 * 1024 ** 3).assertCanEverFit({ cpu: "16", memory: "1Gi" }),
    ).resolves.toBeUndefined();
  });
});
