// TEST_OVERVIEW: the first result the assistant reports — a schedule set, an
// TEST_OVERVIEW: artifact made, a saved knowledge base — is recorded once per
// TEST_OVERVIEW: account: a later report changes nothing and is answered with the
// TEST_OVERVIEW: first one, so the moment the person's onboarding finished cannot
// TEST_OVERVIEW: move. It is the caller's own record that is written, the checklist
// TEST_OVERVIEW: counts the task the kind names as done and seen (and has no item for
// TEST_OVERVIEW: a knowledge base), one event announces it for anything that carries
// TEST_OVERVIEW: the news elsewhere, and the onboarding reset forgets it.
import { EventType, events$ } from "../../events.js";
import { describe, expect, it } from "vitest";

import {
  assistantService,
  OWNER,
  rowStore,
} from "../helpers/assistant-world.js";

async function withEvents<T>(
  work: () => Promise<T>,
): Promise<{ value: T; recorded: unknown[] }> {
  const recorded: unknown[] = [];
  const subscription = events$().subscribe((event) => {
    if (event.type === EventType.AssistantFirstResultRecorded)
      recorded.push(event);
  });
  try {
    return { value: await work(), recorded };
  } finally {
    subscription.unsubscribe();
  }
}

describe("the first result", () => {
  // TEST_SCENARIO: an assistant reports a schedule it set for the person; the record holds it, the checklist counts that task as done, and one event carries the news with the owner, the kind and the reference.
  it("records the first result, its checklist task and one event", async () => {
    const w = assistantService();
    await w.optIn();
    const { value, recorded } = await withEvents(() =>
      w.assistants.recordFirstResult({
        kind: "schedule",
        ref: "agent-dammy/weekly",
      }),
    );
    expect(value).toMatchObject({
      kind: "schedule",
      ref: "agent-dammy/weekly",
    });
    expect(value?.at).toEqual(expect.any(String));
    expect(await w.assistants.state()).toMatchObject({
      firstResult: { kind: "schedule" },
    });
    expect(w.recordTask).toHaveBeenCalledWith("create-schedule");
    expect(recorded).toEqual([
      {
        type: EventType.AssistantFirstResultRecorded,
        owner: OWNER,
        kind: "schedule",
        ref: "agent-dammy/weekly",
      },
    ]);
  });

  // TEST_SCENARIO: a second report — another artifact, later the same day — writes nothing: it is answered with the first result, announces nothing, and counts no second task.
  it("answers a later report with the first one, changing nothing", async () => {
    const w = assistantService();
    await w.optIn();
    const first = await w.assistants.recordFirstResult({ kind: "artifact" });
    const { value, recorded } = await withEvents(() =>
      w.assistants.recordFirstResult({
        kind: "schedule",
        ref: "later",
      }),
    );
    expect(value).toEqual(first);
    expect(recorded).toEqual([]);
    expect(w.recordTask).toHaveBeenCalledTimes(1);
    expect(w.recordTask).toHaveBeenCalledWith("create-artifact");
  });

  // TEST_SCENARIO: a saved knowledge base has no checklist item, so the result is recorded and nothing new shows on the checklist — the kind is simply stored.
  it("records a knowledge base without counting a task", async () => {
    const w = assistantService();
    await w.optIn();
    const result = await w.assistants.recordFirstResult({
      kind: "knowledgeBase",
      ref: "Team handbook",
    });
    expect(result).toMatchObject({
      kind: "knowledgeBase",
      ref: "Team handbook",
    });
    expect(w.recordTask).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: a report is written to the caller's own record only: another person's assistant keeps the result it had.
  it("writes only the caller's record", async () => {
    const rows = rowStore({
      owner: OWNER,
      agentId: "agent-dammy",
      state: "ready",
      legacy: false,
      used: true,
      resetAt: null,
      firstResult: null,
    });
    rows.rows.set("bob", {
      owner: "bob",
      agentId: "agent-bobs",
      state: "ready",
      legacy: false,
      used: true,
      resetAt: null,
      firstResult: { kind: "artifact", ref: null, at: new Date() },
    });
    const w = assistantService({ rows });
    await w.assistants.recordFirstResult({ kind: "schedule" });
    expect(rows.rows.get(OWNER)?.firstResult).toMatchObject({
      kind: "schedule",
    });
    expect(rows.rows.get("bob")?.firstResult).toMatchObject({
      kind: "artifact",
    });
  });

  // TEST_SCENARIO: a caller with no record — an install that never made them an assistant — gets nothing recorded and nothing announced, rather than an error or a row out of nowhere.
  it("records nothing for a person with no assistant record", async () => {
    const w = assistantService();
    const { value, recorded } = await withEvents(() =>
      w.assistants.recordFirstResult({ kind: "artifact" }),
    );
    expect(value).toBeNull();
    expect(recorded).toEqual([]);
    expect(w.recordTask).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the onboarding reset forgets the first result with everything else, so the person who starts over reaches their first result again — and the second one is recorded rather than answered from the first.
  it("is forgotten by the onboarding reset", async () => {
    const w = assistantService();
    await w.optIn();
    await w.assistants.recordFirstResult({ kind: "schedule" });
    await w.assistants.resetOnboarding();
    expect(await w.assistants.state()).toMatchObject({ firstResult: null });

    const again = await w.assistants.recordFirstResult({ kind: "artifact" });
    expect(again).toMatchObject({ kind: "artifact" });
    expect(w.recordTask).toHaveBeenLastCalledWith("create-artifact");
  });
});
