// TEST_OVERVIEW: Dambledore is made under the brand's assistant name, and the name
// TEST_OVERVIEW: is the rule: an Agent of the person's already called that is
// TEST_OVERVIEW: adopted, and only a person with none gets one made. The switch
// TEST_OVERVIEW: makes one whenever there is none — so a delete or a rename and a
// TEST_OVERVIEW: fresh switch-on makes a new one — while an install that pins the
// TEST_OVERVIEW: feature on makes one at the person's first admitted request, once
// TEST_OVERVIEW: per person, so a delete stays deleted. Concurrent callers make one
// TEST_OVERVIEW: Agent between them.
import { describe, expect, it } from "vitest";

import {
  agentStore,
  assistantService,
  NAME,
  OWNER,
  rowStore,
} from "../helpers/assistant-world.js";

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

  // TEST_SCENARIO: the person already owns an Agent called Dambledore, so nothing is made for them and the record follows the Agent they have.
  it("adopts an Agent the person already has under that name", async () => {
    const agents = agentStore([NAME]);
    const w = assistantService({ agents });
    await w.ensure();
    expect(agents.create).not.toHaveBeenCalled();
    expect(w.rows.rows.get(OWNER)).toMatchObject({
      agentId: agents.ids()[0],
      state: "ready",
    });
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

  // TEST_SCENARIO: two requests meet the platform at once; the record's primary key settles which one makes the Agent, so there is one between them.
  it("makes one Agent when two requests race", async () => {
    const w = assistantService();
    await Promise.all([w.ensure(), w.ensure()]);
    expect(w.agents.create).toHaveBeenCalledTimes(1);
    expect(w.agents.ids()).toHaveLength(1);
  });

  // TEST_SCENARIO: the person deleted Dambledore; the record still says they were given one, so no later request makes another — a pinned-on install has no switch, and the reset is their way to ask again.
  it("does not make another after the person deleted theirs", async () => {
    const agents = agentStore([NAME]);
    const w = assistantService({ agents });
    await w.ensure();
    agents.remove(agents.ids()[0]!);
    await w.ensure();
    expect(agents.create).not.toHaveBeenCalled();
    expect(agents.ids()).toHaveLength(0);
  });

  // TEST_SCENARIO: the create failed, so the record still says its Agent is being made; a later request asks for that same Agent rather than abandoning it.
  it("retries the same Agent after a failed create", async () => {
    const agents = agentStore();
    const w = assistantService({ agents });
    agents.create.mockRejectedValueOnce(new Error("apiserver said no"));
    await w.ensure();
    const pending = w.rows.rows.get(OWNER)!;
    expect(pending.state).toBe("creating");
    await w.ensure();
    expect(agents.create).toHaveBeenCalledTimes(2);
    expect(agents.create.mock.calls[1]![0]).toMatchObject({
      id: pending.agentId,
    });
    expect(agents.ids()).toEqual([pending.agentId]);
  });

  // TEST_SCENARIO: a person whose Agent is already recorded is answered by the record alone: one read, no create.
  it("leaves a person whose Agent is recorded alone", async () => {
    const rows = rowStore({
      owner: OWNER,
      agentId: "agent-a",
      state: "ready",
      used: false,
      resetAt: null,
    });
    const w = assistantService({ rows });
    await w.ensure();
    expect(w.agents.create).not.toHaveBeenCalled();
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

  // TEST_SCENARIO: the person deleted theirs, then switched the feature off and on again: a new Agent is made and the record follows it, unused.
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

  // TEST_SCENARIO: the person renamed theirs, so no Agent of theirs carries the name: switching the feature on makes a new one, and the renamed Agent stays theirs, untouched.
  it("makes a new Agent after the person renamed theirs", async () => {
    const w = assistantService();
    await w.optIn();
    const first = w.agents.ids()[0]!;
    w.agents.rename(first, "Research helper");
    await w.optIn();
    expect(w.agents.create).toHaveBeenCalledTimes(2);
    expect(w.agents.named("Research helper")).toEqual([first]);
    const mine = w.agents.named(NAME);
    expect(mine).toHaveLength(1);
    expect(mine[0]).not.toBe(first);
    expect(w.rows.rows.get(OWNER)).toMatchObject({ agentId: mine[0] });
  });

  // TEST_SCENARIO: an Agent of the person's already carries the name — theirs from before, or one they made — so nothing is made and the record follows it.
  it("makes nothing when an Agent already carries the name", async () => {
    const agents = agentStore([NAME]);
    const w = assistantService({ agents });
    await w.optIn();
    expect(agents.create).not.toHaveBeenCalled();
    expect(w.rows.rows.get(OWNER)).toMatchObject({ agentId: agents.ids()[0] });
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

  // TEST_SCENARIO: two switches flipped at once make one Agent between them.
  it("makes one Agent when two switches race", async () => {
    const w = assistantService();
    await Promise.all([w.optIn(), w.optIn()]);
    expect(w.agents.create).toHaveBeenCalledTimes(1);
    expect(w.agents.named(NAME)).toHaveLength(1);
  });
});
