// TEST_OVERVIEW: the first result the assistant reports — a schedule set, an
// TEST_OVERVIEW: artifact made, a saved knowledge base — is recorded once per
// TEST_OVERVIEW: account, in one per-owner transaction shared with every onboarding
// TEST_OVERVIEW: reset: a report claims, ticks the checklist and marks itself done
// TEST_OVERVIEW: inside it, and no reset lands between those steps. A later report
// TEST_OVERVIEW: changes nothing and is answered with the first one; a claim whose
// TEST_OVERVIEW: caller died is finished by the next caller, ticked once and
// TEST_OVERVIEW: announced once; the event carries the onboarding epoch it completed
// TEST_OVERVIEW: in and is at most once, the seam having no consumer yet.
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

/** UNIT_BOUNDARY_DESCRIPTION: a claim written without its side effects — the state a caller leaves when it dies inside the locked section. */
function crashedClaim(
  w: ReturnType<typeof assistantService>,
  kind: "schedule" | "artifact" | "knowledgeBase" = "schedule",
) {
  const row = w.rows.rows.get(OWNER)!;
  w.rows.rows.set(OWNER, {
    ...row,
    firstResult: { kind, ref: null, at: new Date(), completed: false },
  });
}

async function until(reached: () => boolean): Promise<void> {
  while (!reached()) await new Promise((resolve) => setImmediate(resolve));
}

describe("the first result", () => {
  // TEST_SCENARIO: the assistant reports a schedule it set; the record holds it, the checklist counts that task as done, and one event carries the news with the owner, the kind, the reference and the onboarding epoch it completed in.
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
        epoch: 0,
      },
    ]);
  });

  // TEST_SCENARIO: a second report — another artifact, later the same day — writes nothing: it is answered with the first result, announces nothing, and counts no second task.
  it("answers a later report with the first one, changing nothing", async () => {
    const w = assistantService();
    await w.optIn();
    const first = await w.assistants.recordFirstResult({ kind: "artifact" });
    const { value, recorded } = await withEvents(() =>
      w.assistants.recordFirstResult({ kind: "schedule", ref: "later" }),
    );
    expect(value).toEqual(first);
    expect(recorded).toEqual([]);
    expect(w.recordTask).toHaveBeenCalledTimes(1);
    expect(w.recordTask).toHaveBeenCalledWith("create-artifact");
  });

  // TEST_SCENARIO: a saved knowledge base has no checklist item, so the result is recorded and nothing new shows on the checklist.
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

  // TEST_SCENARIO: a report is written to the caller's own record only.
  it("writes only the caller's record", async () => {
    const rows = rowStore({
      owner: OWNER,
      agentId: "agent-dammy",
      state: "ready",
      legacy: false,
      used: true,
      resetAt: null,
      firstResult: null,
      epoch: 0,
    });
    rows.rows.set("bob", {
      owner: "bob",
      agentId: "agent-bobs",
      state: "ready",
      legacy: false,
      used: true,
      resetAt: null,
      firstResult: {
        kind: "artifact",
        ref: null,
        at: new Date(),
        completed: true,
      },
      epoch: 0,
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

  // TEST_SCENARIO: a caller with no record — an install that never made them an assistant — gets nothing recorded and nothing announced.
  it("records nothing for a person with no assistant record", async () => {
    const w = assistantService();
    const { value, recorded } = await withEvents(() =>
      w.assistants.recordFirstResult({ kind: "artifact" }),
    );
    expect(value).toBeNull();
    expect(recorded).toEqual([]);
    expect(w.recordTask).not.toHaveBeenCalled();
  });
});

describe("the first result's side effects", () => {
  // TEST_SCENARIO: the claim was written and its caller died before the checklist and the announcement, so a later report finishes them — one tick, one event, and the result it answers with is the one already claimed.
  it("finishes a claim whose caller never completed it", async () => {
    const w = assistantService();
    await w.optIn();
    crashedClaim(w);

    const { value, recorded } = await withEvents(() =>
      w.assistants.recordFirstResult({ kind: "artifact", ref: "later" }),
    );
    expect(value).toMatchObject({ kind: "schedule", ref: null });
    expect(w.recordTask).toHaveBeenCalledTimes(1);
    expect(w.recordTask).toHaveBeenCalledWith("create-schedule");
    expect(recorded).toEqual([
      expect.objectContaining({ kind: "schedule", ref: null }),
    ]);
  });

  // TEST_SCENARIO: the request path finishes it too, in the same locked section, so a claim nobody completed does not wait for another report.
  it("finishes it on the request path as well", async () => {
    const w = assistantService();
    await w.optIn();
    crashedClaim(w, "artifact");
    const { recorded } = await withEvents(() => w.ensure());
    expect(w.recordTask).toHaveBeenCalledWith("create-artifact");
    expect(recorded).toHaveLength(1);
  });

  // TEST_SCENARIO: a report that has finished leaves nothing for the next caller: no second tick and no second event, however many calls come.
  it("announces once for a completed result", async () => {
    const w = assistantService();
    await w.optIn();
    await w.assistants.recordFirstResult({ kind: "schedule" });
    const { recorded } = await withEvents(async () => {
      await w.assistants.recordFirstResult({ kind: "schedule" });
      await w.ensure();
    });
    expect(recorded).toEqual([]);
    expect(w.recordTask).toHaveBeenCalledTimes(1);
  });

  // TEST_SCENARIO: a report holds the lock, parked at its checklist tick, while a reset waits behind it: the report finishes first — its tick and its event — and only then does the reset clear the result and move the epoch on.
  it("lets a report finish before a waiting reset", async () => {
    const w = assistantService();
    await w.optIn();
    let open = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    w.recordTask.mockImplementationOnce(async () => {
      await gate;
    });

    const report = withEvents(() =>
      w.assistants.recordFirstResult({ kind: "schedule" }),
    );
    await until(() => w.recordTask.mock.calls.length === 1);
    expect(w.rows.rows.get(OWNER)?.firstResult).toMatchObject({
      completed: false,
    });
    const reset = w.assistants.resetOnboarding();
    open();
    const { recorded } = await report;
    await reset;

    expect(recorded).toHaveLength(1);
    expect(w.recordTask).toHaveBeenCalledTimes(1);
    expect(w.rows.rows.get(OWNER)).toMatchObject({
      firstResult: null,
      epoch: 1,
    });
  });

  // TEST_SCENARIO: a reset holds the lock, parked after clearing the result and moving the epoch, while a report waits behind it: the report then records its own result in the onboarding it finds, and nothing is announced for the one that was cleared.
  it("makes a waiting report start over after a reset", async () => {
    const w = assistantService();
    await w.optIn();
    await w.assistants.recordFirstResult({ kind: "schedule" });

    let open = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    w.resetChecklist.mockImplementationOnce(async () => {
      await gate;
    });

    const reset = w.assistants.resetOnboarding();
    await until(() => w.rows.rows.get(OWNER)?.epoch === 1);
    /* UNIT_BOUNDARY_DESCRIPTION: the report is started without being awaited — it is waiting for the lock the reset holds, so awaiting it here would wait for a gate that is opened after it returns. */
    const report = withEvents(() =>
      w.assistants.recordFirstResult({ kind: "artifact" }),
    );
    open();
    const { value, recorded } = await report;
    await reset;

    expect(value).toMatchObject({ kind: "artifact" });
    expect(recorded).toEqual([expect.objectContaining({ kind: "artifact" })]);
    expect(w.rows.rows.get(OWNER)).toMatchObject({ epoch: 1 });
    expect(w.recordTask).toHaveBeenCalledWith("create-artifact");
  });

  // TEST_SCENARIO: the reset forgets the first result whether or not the feature is on for the person, and each reset moves the onboarding epoch on by exactly one — a number, not a timestamp, so nothing is decided by a clock.
  it("is cleared by the reset, with the feature on or off", async () => {
    const on = assistantService();
    await on.optIn();
    await on.assistants.recordFirstResult({ kind: "schedule" });
    await on.assistants.resetOnboarding();
    expect(on.rows.rows.get(OWNER)?.firstResult).toBeNull();
    expect(on.rows.rows.get(OWNER)?.epoch).toBe(1);
    await on.assistants.resetOnboarding();
    expect(on.rows.rows.get(OWNER)?.epoch).toBe(2);

    const rows = rowStore({
      owner: OWNER,
      agentId: "agent-dammy",
      state: "ready",
      legacy: false,
      used: true,
      resetAt: null,
      firstResult: {
        kind: "schedule",
        ref: null,
        at: new Date(),
        completed: true,
      },
      epoch: 0,
    });
    const off = assistantService({ rows, enabled: false });
    await off.assistants.resetOnboarding();
    expect(rows.rows.get(OWNER)?.firstResult).toBeNull();
    expect(rows.rows.get(OWNER)?.epoch).toBe(1);
  });
});
