// TEST_OVERVIEW: the api-server's half of a kit-seed event. The delivery sends the event only after withdrawing an earlier one still waiting, says whether the Agent's runtime advertises the kind, and reads the runtime's answer from the event's report: none yet, seeded, or refused with the reason. The outcome handler records the commit the runtime answered as the Seed Stamp, for a seed that follows a branch.
import { describe, expect, it } from "vitest";
import type { SeedStamp } from "api-server-api";

import { createKitSeedDelivery } from "../../modules/starter-kits/infrastructure/kit-seed-delivery.js";
import { createKitSeedOutcome } from "../../modules/starter-kits/services/kit-seed-outcome.js";

const COMMIT = "c".repeat(40);
const SEED = {
  url: "https://github.com/acme/desk",
  branch: "main",
  into: "home" as const,
};

function delivery(
  report: { reportedAt: Date | null; error: string | null } | null,
  capabilities: unknown = { events: ["kit-seed"] },
) {
  const calls: string[] = [];
  const svc = createKitSeedDelivery({
    capabilities: async () => capabilities,
    runtimeMutator: {
      supersede: async (_id, kind) => {
        calls.push(`supersede ${kind}`);
      },
      bump: async (_id, events) => {
        calls.push(`bump ${events.map((e) => e.kind).join(",")}`);
        return 1;
      },
      enqueueAfterCommit: async () => {
        calls.push("enqueue");
      },
    },
    readEventReport: async () => report,
  });
  return { svc, calls };
}

describe("kit-seed delivery", () => {
  it("withdraws an earlier kit-seed before it sends one", async () => {
    const { svc, calls } = delivery(null);
    const id = await svc.send("agent-1", SEED);
    expect(id).toMatch(/^kit-seed:agent-1:/);
    expect(calls).toEqual(["supersede kit-seed", "bump kit-seed", "enqueue"]);
  });

  it.each([
    [{ events: ["kit-seed", "trigger"] }, true],
    [{ events: ["workspace-seed"] }, false],
    [null, null],
  ])("reads what the runtime advertised (%o)", async (capabilities, want) => {
    expect(await delivery(null, capabilities).svc.supports("agent-1")).toBe(
      want,
    );
  });

  it.each([
    [null, { state: "pending" }],
    [{ reportedAt: null, error: null }, { state: "pending" }],
    [{ reportedAt: new Date(), error: null }, { state: "seeded" }],
    [
      { reportedAt: new Date(), error: "files are there" },
      { state: "refused", reason: "files are there" },
    ],
  ])("answers from the report (%o)", async (report, want) => {
    expect(await delivery(report).svc.answer("agent-1", "e")).toEqual(want);
  });
});

describe("kit-seed outcome", () => {
  function outcome() {
    const stamps: { agentId: string; stamp: SeedStamp }[] = [];
    const handle = createKitSeedOutcome({
      stampSeed: async (agentId, stamp) => {
        stamps.push({ agentId, stamp });
      },
    });
    return { handle, stamps };
  }

  it("records the answered commit as the Seed Stamp", async () => {
    const { handle, stamps } = outcome();
    await handle(
      { agentId: "agent-1", payload: SEED },
      { outcome: "ok", detail: COMMIT },
    );
    expect(stamps).toEqual([
      {
        agentId: "agent-1",
        stamp: { url: SEED.url, branch: "main", commit: COMMIT },
      },
    ]);
  });

  it.each([
    [
      "a refusal",
      { agentId: "agent-1", payload: SEED },
      { outcome: "declined" as const, detail: "no" },
    ],
    [
      "an answer that is no commit",
      { agentId: "agent-1", payload: SEED },
      { outcome: "ok" as const, detail: "done" },
    ],
    [
      "a seed pinned to a commit",
      {
        agentId: "agent-1",
        payload: { url: SEED.url, commit: COMMIT, into: "work" },
      },
      { outcome: "ok" as const, detail: COMMIT },
    ],
  ])("records nothing for %s", async (_why, event, input) => {
    const { handle, stamps } = outcome();
    await handle(event, input);
    expect(stamps).toEqual([]);
  });
});
