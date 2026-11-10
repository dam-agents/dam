// TEST_OVERVIEW: "Reset user onboarding" starts one person's onboarding over and
// TEST_OVERVIEW: nobody else's: it forgets that their assistant was ever used,
// TEST_OVERVIEW: starts the Get started checklist over, records its first Agent
// TEST_OVERVIEW: again so the person meets a first-timer's checklist, and gives
// TEST_OVERVIEW: them Dambledore again when they have none — deleted or renamed
// TEST_OVERVIEW: away — while an Agent of theirs already called that is reused, with
// TEST_OVERVIEW: the record following it. It is refused while the feature is off for
// TEST_OVERVIEW: them.
import { describe, expect, it } from "vitest";

import {
  agentStore,
  assistantService,
  NAME,
  OWNER,
  rowStore,
} from "../helpers/assistant-world.js";

describe("resetting a person's onboarding", () => {
  // TEST_SCENARIO: the person has an assistant they have used; the reset forgets that, starts the checklist over and records its first Agent again, so they meet a first-timer's checklist — nothing is deleted and nothing is made.
  it("forgets the use and starts the checklist over", async () => {
    const agents = agentStore([NAME]);
    const w = assistantService({ agents });
    await w.ensure();
    const id = agents.ids()[0]!;
    await w.rows.repo.markUsed(id);
    await w.assistants.resetOnboarding();
    const state = await w.assistants.state();
    expect(state).toMatchObject({ agentId: id, used: false });
    expect(state?.resetAt).toEqual(expect.any(String));
    expect(w.resetChecklist).toHaveBeenCalledTimes(1);
    expect(w.provisioned).toHaveBeenCalledTimes(2);
    expect(agents.create).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the person deleted theirs, so the reset makes a new ordinary Agent, points the record at it, unused: the next landing greets them in its chat.
  it("makes the assistant again when the person deleted theirs", async () => {
    const w = assistantService();
    await w.optIn();
    const first = w.agents.ids()[0]!;
    w.agents.remove(first);
    await w.assistants.resetOnboarding();
    expect(w.agents.create).toHaveBeenCalledTimes(2);
    const ids = w.agents.ids();
    expect(ids).toHaveLength(1);
    expect(ids[0]).not.toBe(first);
    expect(await w.assistants.state()).toMatchObject({
      agentId: ids[0],
      used: false,
    });
    expect(w.provisioned).toHaveBeenCalledTimes(2);
  });

  // TEST_SCENARIO: the person renamed theirs and made one themselves under the name — or simply has one — so the reset reuses that Agent rather than making a second, and forgets that it was used.
  it("reuses an Agent that already carries the name", async () => {
    const agents = agentStore([NAME]);
    const w = assistantService({ agents });
    await w.ensure();
    const id = agents.ids()[0]!;
    await w.rows.repo.markUsed(id);
    await w.assistants.resetOnboarding();
    expect(agents.create).not.toHaveBeenCalled();
    expect(agents.ids()).toEqual([id]);
    expect(await w.assistants.state()).toMatchObject({
      agentId: id,
      used: false,
    });
  });

  // TEST_SCENARIO: the person renamed theirs, so the name is free: the reset makes a new Dambledore and leaves the renamed Agent where it is.
  it("makes a new assistant after the person renamed theirs", async () => {
    const w = assistantService();
    await w.optIn();
    const first = w.agents.ids()[0]!;
    w.agents.rename(first, "Research helper");
    await w.assistants.resetOnboarding();
    expect(w.agents.named("Research helper")).toEqual([first]);
    expect(w.agents.named(NAME)).toHaveLength(1);
    expect(w.agents.named(NAME)[0]).not.toBe(first);
  });

  // TEST_SCENARIO: two resets meet the same deleted assistant at once; the record's compare-and-set gives one of them the replacement and the other adopts the Agent it names, so one Agent is made between them.
  it("makes one Agent when two resets meet", async () => {
    const w = assistantService();
    await w.optIn();
    w.agents.remove(w.agents.ids()[0]!);
    await Promise.all([
      w.assistants.resetOnboarding(),
      w.assistants.resetOnboarding(),
    ]);
    expect(w.agents.named(NAME)).toHaveLength(1);
  });

  // TEST_SCENARIO: two people reset at once; each reset touches only its caller's record, and the other person's assistant keeps the use it had.
  it("resets only the caller's assistant", async () => {
    const rows = rowStore({
      owner: OWNER,
      agentId: "agent-a",
      state: "ready",
      used: true,
      resetAt: null,
    });
    rows.rows.set("bob", {
      owner: "bob",
      agentId: "agent-b",
      state: "ready",
      used: true,
      resetAt: null,
    });
    const w = assistantService({ rows, agents: agentStore([NAME]) });
    await w.assistants.resetOnboarding();
    expect(rows.rows.get(OWNER)).toMatchObject({ used: false });
    expect(rows.rows.get("bob")).toMatchObject({ used: true });
  });

  // TEST_SCENARIO: the feature is off for the caller — the install pins it off, or they turned it off — so the reset is refused rather than quietly giving them Dambledore.
  it("is refused while the feature is off for the caller", async () => {
    const w = assistantService({ enabled: false });
    await expect(w.assistants.resetOnboarding()).rejects.toThrow(
      "does not offer the assistant",
    );
    expect(w.agents.create).not.toHaveBeenCalled();
    expect(w.resetChecklist).not.toHaveBeenCalled();
  });
});
