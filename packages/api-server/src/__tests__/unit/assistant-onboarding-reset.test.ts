// TEST_OVERVIEW: "Reset user onboarding" starts one person's onboarding over and
// TEST_OVERVIEW: nobody else's: it forgets that their assistant was ever used,
// TEST_OVERVIEW: starts the Get started checklist over, records its first Agent
// TEST_OVERVIEW: again so the person meets a first-timer's checklist, and gives
// TEST_OVERVIEW: them Dambledore again when the platform's own is gone — but only
// TEST_OVERVIEW: when no Agent of theirs carries the name, since an Agent they made
// TEST_OVERVIEW: is not the platform's and is never adopted. A create another caller
// TEST_OVERVIEW: holds is waited for rather than raced. It is one reset for
// TEST_OVERVIEW: everyone: the checklist always, the assistant only when the feature
// TEST_OVERVIEW: is on for them, and never a refusal.
import { avatarCharacter } from "api-server-api/avatar/svg";
import { describe, expect, it, vi } from "vitest";

import { toProgress } from "../../modules/getting-started/domain/unlocks.js";
import type { Checklist } from "../../modules/getting-started/domain/unlocks.js";
import type { GettingStartedRepository } from "../../modules/getting-started/infrastructure/getting-started-repository.js";
import { createEnrollment } from "../../modules/getting-started/services/enrollment.js";
import { recordProvisionedAgent } from "../../modules/getting-started/services/first-agent.js";
import { createUnlockRecorder } from "../../modules/getting-started/services/unlock-recorder.js";
import {
  agentStore,
  assistantService,
  NAME,
  OWNER,
  rowStore,
} from "../helpers/assistant-world.js";

/** UNIT_BOUNDARY_DESCRIPTION: the checklist's store as the database behaves — a task unlocks once, the character it was created with is the one it records, and a reset deletes every row. */
function checklistRepo(): GettingStartedRepository & {
  checklists: Map<string, Checklist>;
} {
  const checklists = new Map<string, Checklist>();
  let clock = 0;
  const tick = () => new Date(Date.UTC(2026, 0, 1, 0, 0, clock++));
  return {
    checklists,
    async find(owner) {
      return checklists.get(owner) ?? null;
    },
    async enroll(owner, unlocked) {
      if (checklists.has(owner)) return;
      checklists.set(owner, {
        dismissedAt: null,
        unlocks: unlocked.map((u) => ({
          ...u,
          unlockedAt: tick(),
          seenAt: tick(),
          pickedAt: tick(),
        })),
      });
    },
    async unlock(owner, task, choose) {
      const c = checklists.get(owner)!;
      if (c.unlocks.some((u) => u.task === task)) return null;
      const chosen = choose(new Set(c.unlocks.map((u) => u.character)));
      if (!chosen) return null;
      const unlock = {
        task,
        character: chosen.character,
        unlockedAt: tick(),
        seenAt: null,
        pickedAt: chosen.picked ? tick() : null,
      };
      checklists.set(owner, {
        dismissedAt: null,
        unlocks: [...c.unlocks, unlock],
      });
      return unlock;
    },
    async markSeen(owner, task) {
      const c = checklists.get(owner)!;
      checklists.set(owner, {
        ...c,
        unlocks: c.unlocks.map((u) =>
          u.task === task ? { ...u, seenAt: u.seenAt ?? tick() } : u,
        ),
      });
    },
    async markPicked(owner, character) {
      const c = checklists.get(owner)!;
      checklists.set(owner, {
        ...c,
        unlocks: c.unlocks.map((u) =>
          u.character === character
            ? { ...u, pickedAt: u.pickedAt ?? tick() }
            : u,
        ),
      });
    },
    async setDismissed(owner, dismissed) {
      const c = checklists.get(owner)!;
      checklists.set(owner, { ...c, dismissedAt: dismissed ? tick() : null });
    },
    async reset(owner) {
      checklists.set(owner, { dismissedAt: null, unlocks: [] });
    },
  };
}

const readyRow = (agentId: string, used = true) => ({
  owner: OWNER,
  agentId,
  state: "ready" as const,
  legacy: false,
  firstResult: null,
  epoch: 0,
  used,
  resetAt: null,
});

async function until(reached: () => boolean): Promise<void> {
  while (!reached()) await new Promise((resolve) => setImmediate(resolve));
}

describe("resetting a person's onboarding", () => {
  // TEST_SCENARIO: the person has an assistant they have used; the reset forgets that, starts the checklist over and records its first Agent again, so they meet a first-timer's checklist — nothing is deleted and nothing is made.
  it("forgets the use and starts the checklist over", async () => {
    const agents = agentStore();
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
    expect(agents.create).toHaveBeenCalledTimes(1);
  });

  // TEST_SCENARIO: the person deleted theirs, so the reset makes a new ordinary Agent, points the record at it, unused: the next landing greets them in its chat.
  // TEST_SCENARIO: the Agent a reset makes is one the platform creates, so it carries the owner's Connection; the reset is a door like the switch and the pinned-on request.
  it("gives the Connection to the Agent it makes", async () => {
    const agents = agentStore();
    const w = assistantService({
      agents,
      damConnection: async () => "conn-dam",
    });
    await w.assistants.resetOnboarding();
    expect(agents.create).toHaveBeenCalledTimes(1);
    expect(agents.create.mock.calls[0]![0]).toMatchObject({
      connectionIds: ["conn-dam"],
      platformGrants: true,
    });
  });

  // TEST_SCENARIO: the reset finds an Agent the person made under the name, so nothing is created and the Connection is never granted at all.
  it("gives the Connection to nothing it does not create", async () => {
    const agents = agentStore([NAME]);
    const damConnection = vi.fn(async () => "conn-dam");
    const w = assistantService({ agents, damConnection });
    await w.assistants.resetOnboarding();
    expect(agents.create).not.toHaveBeenCalled();
    expect(damConnection).not.toHaveBeenCalled();
  });

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

  // TEST_SCENARIO: an Agent the person made carries the name, and the platform's own is gone: nothing is made, because the name is theirs — and no record means no greeting and no landing on it.
  it("makes nothing when the person owns an Agent under the name", async () => {
    const rows = rowStore(readyRow("agent-gone"));
    const w = assistantService({ rows, agents: agentStore([NAME]) });
    await w.assistants.resetOnboarding();
    expect(w.agents.create).not.toHaveBeenCalled();
    expect(rows.rows.get(OWNER)).toMatchObject({ agentId: "agent-gone" });
    expect(w.provisioned).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the person renamed the Agent the platform made, so nothing carries the name — and the record still names it, so the reset reuses that Agent rather than making a second one.
  it("reuses the Agent the record names, renamed", async () => {
    const agents = agentStore();
    const w = assistantService({ agents });
    await w.ensure();
    const id = agents.ids()[0]!;
    agents.rename(id, "Research helper");
    await w.rows.repo.markUsed(id);
    await w.assistants.resetOnboarding();
    expect(agents.create).toHaveBeenCalledTimes(1);
    expect(agents.ids()).toEqual([id]);
    expect(await w.assistants.state()).toMatchObject({
      agentId: id,
      used: false,
    });
  });

  // TEST_SCENARIO: a create another caller holds is waited for rather than raced: the reset stays pending while the Agent is being made, and lands on it once it is there, so one Agent is made between them.
  it("waits for a create in flight and lands on it", async () => {
    const agents = agentStore();
    const w = assistantService({ agents });
    const release = agents.holdCreate();
    const first = w.optIn();
    await until(() => agents.create.mock.calls.length === 1);
    let landed = false;
    const reset = w.assistants.resetOnboarding().then(() => (landed = true));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(landed).toBe(false);
    release();
    await Promise.all([first, reset]);
    expect(landed).toBe(true);
    expect(agents.create).toHaveBeenCalledTimes(1);
    expect(await w.assistants.state()).toMatchObject({ used: false });
    expect(agents.ids()).toHaveLength(1);
  });

  // TEST_SCENARIO: a claim nobody finished — a create that died — is finished by the reset rather than waited on forever.
  it("finishes a claim nobody holds", async () => {
    const rows = rowStore({
      owner: OWNER,
      agentId: "agent-dead",
      state: "creating",
      legacy: false,
      used: false,
      resetAt: null,
      firstResult: null,
      epoch: 0,
    });
    const w = assistantService({ rows, waitMs: 0 });
    await w.assistants.resetOnboarding();
    expect(w.agents.create).toHaveBeenCalledTimes(1);
    expect(w.agents.create.mock.calls[0]![0]).toMatchObject({
      id: "agent-dead",
    });
    expect(rows.rows.get(OWNER)).toMatchObject({ state: "ready" });
  });

  // TEST_SCENARIO: two resets meet the same deleted assistant at once; the record's compare-and-set gives one of them the replacement and the other joins it, so one Agent is made between them.
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
    const rows = rowStore(readyRow("agent-a"));
    rows.rows.set("bob", {
      owner: "bob",
      agentId: "agent-b",
      state: "ready",
      legacy: false,
      used: true,
      resetAt: null,
      firstResult: null,
      epoch: 0,
    });
    const agents = agentStore();
    // UNIT_BOUNDARY_DESCRIPTION: the caller's own assistant is the Agent their record names, renamed.
    agents.live.set("agent-a", {
      id: "agent-a",
      name: "Research helper",
      owner: OWNER,
      spec: { avatar: undefined },
    } as never);
    const w = assistantService({ rows, agents });
    await w.assistants.resetOnboarding();
    expect(rows.rows.get(OWNER)).toMatchObject({ used: false });
    expect(rows.rows.get("bob")).toMatchObject({ used: true });
  });

  // TEST_SCENARIO: the assistant is off for the person — the install pins it off, or they turned it off — so the one reset restarts the Get started checklist and leaves their agent and its record alone: it is never refused, because it is their onboarding reset either way.
  it("restarts only the checklist for a person it is off for", async () => {
    const rows = rowStore(readyRow("agent-a"));
    const w = assistantService({ rows, agents: agentStore(), enabled: false });
    await w.assistants.resetOnboarding();
    expect(w.resetChecklist).toHaveBeenCalledTimes(1);
    expect(w.agents.create).not.toHaveBeenCalled();
    expect(rows.rows.get(OWNER)).toMatchObject({
      agentId: "agent-a",
      used: true,
      resetAt: null,
    });
    expect(w.provisioned).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: what the reset leaves for the first chat to play — the assistant's create task recorded again, on the Agent's own character and left unseen, which is the row the celebration renders and the one the checklist counts only once the person has seen it.
  it("leaves its create task unseen, for the first chat to celebrate", async () => {
    const repo = checklistRepo();
    const recorder = createUnlockRecorder({
      repo,
      enrollment: createEnrollment({
        repo,
        ownedAgentIds: async () => [],
      }),
      random: () => 0,
    });
    const agents = agentStore();
    const w = assistantService({
      agents,
      provisioned: (agent) =>
        recordProvisionedAgent({ recorder }, OWNER, {
          agentId: agent.id,
          character: avatarCharacter(
            (
              agents.live.get(agent.id) as
                { spec?: { avatar?: string } } | undefined
            )?.spec?.avatar,
            OWNER,
            NAME,
          ),
        }),
    });
    await w.ensure();
    await w.assistants.resetOnboarding();

    const progress = toProgress((await repo.find(OWNER))!);
    expect(progress.unlocks).toHaveLength(1);
    expect(progress.unlocks[0]).toMatchObject({
      task: "create-agent",
      seen: false,
      fresh: false,
    });
  });
});
