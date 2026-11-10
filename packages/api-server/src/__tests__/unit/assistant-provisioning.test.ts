// TEST_OVERVIEW: Dambledore is made under the brand's assistant name, and nothing
// TEST_OVERVIEW: is made under a name an Agent of the person's already carries. The
// TEST_OVERVIEW: record names only an Agent the platform made, and only ever one:
// TEST_OVERVIEW: while that Agent is there — renamed, disabled, asleep — it is the
// TEST_OVERVIEW: assistant and nothing else is made, so an Agent the person made
// TEST_OVERVIEW: under the name is never greeted as the assistant. The switch makes
// TEST_OVERVIEW: one whenever the name is free and reports a failure; an install that
// TEST_OVERVIEW: pins the feature on makes one at the first admitted request, once,
// TEST_OVERVIEW: and logs a failure rather than failing the request. Concurrent
// TEST_OVERVIEW: callers make one Agent between them, and a caller that loses waits
// TEST_OVERVIEW: for the winner's Agent instead of making a second.
import { describe, expect, it } from "vitest";

import {
  agentStore,
  assistantService,
  NAME,
  OWNER,
  rowStore,
} from "../helpers/assistant-world.js";

const readyRow = (agentId: string, used = false) => ({
  owner: OWNER,
  agentId,
  state: "ready" as const,
  used,
  resetAt: null,
});

describe("an install that pins the feature on", () => {
  // TEST_SCENARIO: the person's first admitted request makes one ordinary Agent under the assistant's name, instructed as the greeting says, with no provider chosen for it so it starts on their default profile; the record names it, ready.
  it("makes one Agent at the first admitted request", async () => {
    const w = assistantService();
    await w.ensure();
    expect(w.agents.create).toHaveBeenCalledTimes(1);
    const input = w.agents.create.mock.calls[0]![0];
    expect(input.name).toBe(NAME);
    expect(
      (input as unknown as { instructions: string }).instructions,
    ).toContain(`I'm ${NAME}, your new personal DAM agent!`);
    expect(w.enrolled).toHaveBeenCalledTimes(1);
    expect(w.provisioned).toHaveBeenCalledTimes(1);
    expect(w.rows.rows.get(OWNER)).toMatchObject({
      agentId: w.agents.ids()[0],
      state: "ready",
    });
    expect(await w.assistants.state()).toMatchObject({ used: false });
  });

  // TEST_SCENARIO: an Agent the person made under the name is not the platform's, so nothing is made and no record exists: the greeting and the landing never speak of their Agent.
  it("makes nothing when the person owns an Agent under the name", async () => {
    const agents = agentStore([NAME]);
    const w = assistantService({ agents });
    await w.ensure();
    expect(agents.create).not.toHaveBeenCalled();
    expect(w.rows.rows.size).toBe(0);
    expect(await w.assistants.state()).toBeNull();
  });

  // TEST_SCENARIO: the feature is off for the person, or they have not accepted the Terms of Use, so nothing is made for them.
  it("makes nothing for a person it is off for, or who is not admitted", async () => {
    const off = assistantService({ enabled: false });
    await off.ensure();
    expect(off.agents.create).not.toHaveBeenCalled();
    expect(off.rows.rows.size).toBe(0);

    const unadmitted = assistantService({ admitted: false });
    await unadmitted.ensure();
    expect(unadmitted.agents.create).not.toHaveBeenCalled();
    expect(unadmitted.rows.rows.size).toBe(0);
  });

  // TEST_SCENARIO: two requests meet the platform at once, the second while the first is between the name check and the store write; the record's primary key settles which of them makes the Agent, so there is one between them.
  it("makes one Agent when two requests race", async () => {
    const agents = agentStore();
    const w = assistantService({ agents });
    const release = agents.holdCreate();
    const first = w.ensure();
    const second = w.ensure();
    release();
    await Promise.all([first, second]);
    expect(agents.named(NAME)).toHaveLength(1);
    expect(w.rows.rows.get(OWNER)).toMatchObject({ state: "ready" });
  });

  // TEST_SCENARIO: the person deleted Dambledore; the record still says they were given one, so no later request makes another — a pinned-on install has no switch, and the reset is their way to ask again.
  it("does not make another after the person deleted theirs", async () => {
    const agents = agentStore();
    const w = assistantService({ agents });
    await w.ensure();
    agents.remove(agents.ids()[0]!);
    await w.ensure();
    expect(agents.create).toHaveBeenCalledTimes(1);
    expect(agents.ids()).toHaveLength(0);
  });

  // TEST_SCENARIO: the person renamed the Agent the platform made; the record still names it, so it is the assistant and no request makes a second one.
  it("keeps the Agent the record names, renamed or not", async () => {
    const agents = agentStore();
    const w = assistantService({ agents });
    await w.ensure();
    const id = agents.ids()[0]!;
    agents.rename(id, "Research helper");
    await w.ensure();
    expect(agents.create).toHaveBeenCalledTimes(1);
    expect(agents.ids()).toEqual([id]);
    expect(await w.assistants.state()).toMatchObject({ agentId: id });
  });

  // TEST_SCENARIO: the create failed, so the record still says its Agent is being made and the request is answered rather than failed; a later request asks for that same Agent and finishes it.
  it("logs a failed create and retries the same Agent", async () => {
    const agents = agentStore();
    const w = assistantService({ agents });
    agents.create.mockRejectedValueOnce(new Error("apiserver said no"));
    await expect(w.ensure()).resolves.toBeUndefined();
    const pending = w.rows.rows.get(OWNER)!;
    expect(pending.state).toBe("creating");
    await w.ensure();
    expect(agents.create).toHaveBeenCalledTimes(2);
    expect(agents.create.mock.calls[1]![0]).toMatchObject({
      id: pending.agentId,
    });
    expect(agents.ids()).toEqual([pending.agentId]);
    expect(w.rows.rows.get(OWNER)).toMatchObject({ state: "ready" });
  });
});

describe("the switch", () => {
  // TEST_SCENARIO: the person turns the feature on and owns no Agent under the name, so one is made for them.
  it("makes one Agent when the person switches it on", async () => {
    const w = assistantService();
    await w.optIn();
    expect(w.agents.create).toHaveBeenCalledTimes(1);
    expect(w.agents.named(NAME)).toHaveLength(1);
    expect(w.provisioned).toHaveBeenCalledTimes(1);
  });

  // TEST_SCENARIO: the person's first message marked the assistant used; switching the feature off and on again while theirs still exists changes nothing and does not greet them again.
  it("keeps a Dambledore the person still has", async () => {
    const w = assistantService();
    await w.optIn();
    const id = w.agents.ids()[0]!;
    await w.rows.repo.markUsed(id);
    await w.optIn();
    expect(w.agents.create).toHaveBeenCalledTimes(1);
    expect(w.rows.rows.get(OWNER)).toMatchObject({ agentId: id, used: true });
  });

  // TEST_SCENARIO: the person deleted theirs, then switched the feature off and on again: a new Agent is made, the record follows it, and it is unused.
  it("makes a new Agent after the person deleted theirs", async () => {
    const w = assistantService();
    await w.optIn();
    const first = w.agents.ids()[0]!;
    w.agents.remove(first);
    await w.optIn();
    expect(w.agents.create).toHaveBeenCalledTimes(2);
    const ids = w.agents.ids();
    expect(ids).toHaveLength(1);
    expect(ids[0]).not.toBe(first);
    expect(w.rows.rows.get(OWNER)).toMatchObject({
      agentId: ids[0],
      used: false,
    });
  });

  // TEST_SCENARIO: the person renamed the Agent the platform made, and the record still names it: switching the feature on keeps it, because a renamed Dambledore is still the one the platform gave them.
  it("keeps the Agent it made, renamed", async () => {
    const w = assistantService();
    await w.optIn();
    const first = w.agents.ids()[0]!;
    w.agents.rename(first, "Research helper");
    await w.optIn();
    expect(w.agents.create).toHaveBeenCalledTimes(1);
    expect(w.agents.ids()).toEqual([first]);
    expect(w.rows.rows.get(OWNER)).toMatchObject({ agentId: first });
  });

  // TEST_SCENARIO: an Agent of the person's already carries the name — one they made, read live from the store — so nothing is made and the record is left exactly as it was, still naming the Agent the platform made.
  it("makes nothing when an Agent already carries the name", async () => {
    const rows = rowStore(readyRow("agent-gone", true));
    const agents = agentStore([NAME]);
    const w = assistantService({ rows, agents });
    await w.optIn();
    expect(agents.create).not.toHaveBeenCalled();
    expect(rows.rows.get(OWNER)).toMatchObject({
      agentId: "agent-gone",
      used: true,
    });
  });

  // TEST_SCENARIO: the name is read from the store on every call rather than remembered: while an Agent of theirs carries it nothing is made, and once they rename that Agent away the next switch-on makes Dambledore.
  it("re-reads the name on each call", async () => {
    const agents = agentStore([NAME]);
    const w = assistantService({ agents });
    await w.optIn();
    expect(agents.create).not.toHaveBeenCalled();
    agents.rename(agents.ids()[0]!, "Research helper");
    await w.optIn();
    expect(agents.create).toHaveBeenCalledTimes(1);
    expect(agents.named(NAME)).toHaveLength(1);
  });

  // TEST_SCENARIO: the name is matched exactly and case-sensitively, so an Agent called "dambledore" does not stand in for Dambledore, and no numbered name is ever used for the one it makes.
  it("takes the exact name, never a numbered one", async () => {
    const agents = agentStore(["dambledore", `${NAME} 2`]);
    const w = assistantService({ agents });
    await w.optIn();
    expect(agents.create).toHaveBeenCalledTimes(1);
    expect(agents.create.mock.calls[0]![0]).toMatchObject({ name: NAME });
    expect(agents.named(NAME)).toHaveLength(1);
  });

  // TEST_SCENARIO: two switches flipped at once, the second arriving while the first is between its name check and its store write, make one Agent between them.
  it("makes one Agent when two switches race", async () => {
    const agents = agentStore();
    const w = assistantService({ agents });
    const release = agents.holdCreate();
    const first = w.optIn();
    const second = w.optIn();
    release();
    await Promise.all([first, second]);
    expect(agents.named(NAME)).toHaveLength(1);
    expect(w.rows.rows.get(OWNER)).toMatchObject({ state: "ready" });
  });

  // TEST_SCENARIO: the create failed, so the switch reports the failure to the person rather than pretending it worked, and the claim it took is kept so the retry finishes that same Agent.
  it("reports a failed create, and the retry keeps its claim", async () => {
    const agents = agentStore();
    const w = assistantService({ agents });
    agents.create.mockRejectedValueOnce(new Error("apiserver said no"));
    await expect(w.optIn()).rejects.toThrow("apiserver said no");
    const pending = w.rows.rows.get(OWNER)!;
    expect(pending.state).toBe("creating");
    await w.optIn();
    expect(agents.create.mock.calls[1]![0]).toMatchObject({
      id: pending.agentId,
    });
    expect(agents.ids()).toEqual([pending.agentId]);
    expect(w.rows.rows.get(OWNER)).toMatchObject({ state: "ready" });
  });
});
