// TEST_OVERVIEW: "Reset user onboarding" starts this person's onboarding over and nobody else's: it forgets that their assistant was used — which is what brings the greeting and the first landing back — starts their Get started checklist over through the checklist's own reset, and records the assistant's own first task again the way provisioning records it, so the checklist they are left with is exactly a first-timer's: one of eight, the create-agent task done and seen. It deletes nothing, leaves the one-time rename news alone, succeeds for someone with no assistant yet, and is refused while the feature is off for them.
import { describe, expect, it } from "vitest";
import type { AvatarCharacter } from "api-server-api/avatar/svg";
import type { InfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";
import { toProgress } from "../../modules/getting-started/domain/unlocks.js";
import type {
  Checklist,
  Unlock,
} from "../../modules/getting-started/domain/unlocks.js";
import type { GettingStartedRepository } from "../../modules/getting-started/infrastructure/getting-started-repository.js";
import { createEnrollment } from "../../modules/getting-started/services/enrollment.js";
import { recordProvisionedAgent } from "../../modules/getting-started/services/first-agent.js";
import { createUnlockRecorder } from "../../modules/getting-started/services/unlock-recorder.js";
import type { AssistantsRepository } from "../../modules/assistants/infrastructure/assistants-repository.js";
import { createAssistantsService } from "../../modules/assistants/services/assistants-service.js";

const ALICE = "alice";
const BOB = "bob";
const ASSISTANT = "agent-00000000000000a1";
const CHARACTER = "compass" as AvatarCharacter;

function unused<T extends object>(fields: Partial<T> = {}): T {
  return new Proxy(fields, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected dependency: ${String(key)}`);
    },
  }) as T;
}

/** UNIT_BOUNDARY_DESCRIPTION: the checklist tables as PostgreSQL behaves — one row per task per owner, an unseen unlock carrying no `seenAt`, and a reset that empties both. */
function checklistTables() {
  const checklists = new Map<string, Checklist>();
  const repo = {
    find: async (owner: string) => checklists.get(owner) ?? null,
    enroll: async (owner: string) => {
      if (checklists.has(owner)) return;
      checklists.set(owner, { dismissedAt: null, unlocks: [] });
    },
    unlock: async (
      owner: string,
      task: Unlock["task"],
      choose: (taken: ReadonlySet<AvatarCharacter>) => {
        character: AvatarCharacter;
        picked: boolean;
      } | null,
    ) => {
      const checklist = checklists.get(owner) ?? {
        dismissedAt: null,
        unlocks: [],
      };
      checklists.set(owner, checklist);
      if (checklist.unlocks.some((u) => u.task === task)) return null;
      const chosen = choose(new Set(checklist.unlocks.map((u) => u.character)));
      if (!chosen) return null;
      const unlock: Unlock = {
        task,
        character: chosen.character,
        unlockedAt: new Date(),
        seenAt: null,
        pickedAt: chosen.picked ? new Date() : null,
      };
      checklist.unlocks = [...checklist.unlocks, unlock];
      return unlock;
    },
    markSeen: async (owner: string, task: Unlock["task"]) => {
      const checklist = checklists.get(owner);
      if (!checklist) return;
      checklist.unlocks = checklist.unlocks.map((u) =>
        u.task === task && u.seenAt === null ? { ...u, seenAt: new Date() } : u,
      );
    },
    markPicked: async () => undefined,
    setDismissed: async () => undefined,
    reset: async (owner: string) => {
      const checklist = checklists.get(owner);
      if (!checklist) return;
      checklist.unlocks = [];
    },
  } satisfies GettingStartedRepository;
  return { repo, checklists };
}

/** UNIT_BOUNDARY_DESCRIPTION: two people's assistants, so a reset can be shown to touch only the caller's. */
function world() {
  const used = new Map<string, boolean>([
    [ALICE, true],
    [BOB, true],
  ]);
  const rows = new Set([ALICE, BOB]);
  const assistants = unused<AssistantsRepository>({
    find: async (owner: string) =>
      rows.has(owner)
        ? {
            owner,
            incarnation: 1,
            agentId: ASSISTANT,
            state: "ready" as const,
            steps: [],
            used: used.get(owner) ?? false,
            renamed: {
              agentId: "agent-old",
              from: "Dambledore",
              to: "Dambledore (yours)",
              done: true,
            },
            noticeSeen: false,
          }
        : null,
    resetUsed: async (owner: string) => {
      used.set(owner, false);
    },
  });
  const { repo: checklists, checklists: stored } = checklistTables();
  const recorder = createUnlockRecorder({
    repo: checklists,
    enrollment: createEnrollment({
      repo: checklists,
      ownedAgentIds: async () => [],
    }),
    random: () => 0,
  });
  const agent = {
    id: ASSISTANT,
    name: "Dambledore",
    owner: ALICE,
    kind: "assistant",
    spec: { avatar: `emoji:${CHARACTER}` },
  } as unknown as InfraAgent;
  const serviceFor = (owner: string, enabled = true) =>
    createAssistantsService({
      repo: assistants,
      owner,
      enabled: async () => enabled,
      resetChecklist: () => checklists.reset(owner),
      recordFirstAgent: (first) =>
        recordProvisionedAgent({ recorder, repo: checklists }, owner, first),
      agentOf: async () => (owner === ALICE ? agent : null),
    });
  return { serviceFor, used, stored, checklists };
}

/** UNIT_BOUNDARY_DESCRIPTION: what a first-timer's checklist reads once provisioning has recorded their assistant: one task done and seen, out of the eight. */
async function firstTimerProgress() {
  const { repo, checklists } = checklistTables();
  const recorder = createUnlockRecorder({
    repo,
    enrollment: createEnrollment({ repo, ownedAgentIds: async () => [] }),
    random: () => 0,
  });
  await recordProvisionedAgent({ recorder, repo }, "first", {
    agentId: ASSISTANT,
    character: CHARACTER,
  });
  const { unlocks } = toProgress(checklists.get("first")!);
  return unlocks.map(({ task, character, seen, fresh }) => ({
    task,
    character,
    seen,
    fresh,
  }));
}

describe("resetting one person's onboarding", () => {
  // TEST_SCENARIO: the caller asks for the reset: their assistant counts as unused again and their checklist starts over; another person's row is untouched.
  it("resets the caller's assistant and checklist, and nobody else's", async () => {
    const w = world();
    await w.serviceFor(ALICE).resetOnboarding();

    expect(w.used.get(ALICE)).toBe(false);
    expect(w.used.get(BOB)).toBe(true);
    expect((await w.serviceFor(ALICE).state())?.used).toBe(false);
    expect(w.stored.get(BOB)).toBeUndefined();
  });

  // TEST_SCENARIO: the checklist the reset leaves behind is a first-timer's — one of eight, the assistant's own create-agent task done and seen, with no celebration waiting — not the empty checklist a bare reset leaves.
  it("leaves the checklist a first-timer meets", async () => {
    const w = world();
    await w.serviceFor(ALICE).resetOnboarding();

    const { unlocks } = toProgress(w.stored.get(ALICE)!);
    expect(unlocks).toEqual([
      expect.objectContaining({
        task: "create-agent",
        character: CHARACTER,
        seen: true,
        fresh: false,
      }),
    ]);
    expect(
      unlocks.map(({ task, character, seen, fresh }) => ({
        task,
        character,
        seen,
        fresh,
      })),
    ).toEqual(await firstTimerProgress());
  });

  // TEST_SCENARIO: nothing else about the row changes — the one-time rename news is still there to show, since the reset is not about it.
  it("keeps the rename news", async () => {
    const w = world();
    await w.serviceFor(ALICE).resetOnboarding();
    expect((await w.serviceFor(ALICE).state())?.notice).toEqual({
      renamedFrom: "Dambledore",
      renamedTo: "Dambledore (yours)",
    });
  });

  // TEST_SCENARIO: with the feature off for the person, the reset is refused and nothing is written or reset.
  it("is refused while the feature is off", async () => {
    const w = world();
    await expect(
      w.serviceFor(ALICE, false).resetOnboarding(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(w.used.get(ALICE)).toBe(true);
    expect(w.stored.get(ALICE)).toBeUndefined();
  });

  // TEST_SCENARIO: a person with no assistant yet still resets their checklist — the button is never a failure.
  it("succeeds for a person with no assistant", async () => {
    const w = world();
    await expect(
      w.serviceFor("carol").resetOnboarding(),
    ).resolves.toBeUndefined();
    expect(w.stored.get("carol")).toBeUndefined();
  });
});
