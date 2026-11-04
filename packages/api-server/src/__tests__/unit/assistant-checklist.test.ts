// TEST_OVERVIEW: The assistant is an Agent the platform makes, so its first checklist task is recorded already seen: the Get started pill counts "Create your first agent" as done instead of holding a celebration for something the person did not do. The announcement of that Agent arrives afterwards, finds the task recorded, and adds no second unlock.
import { describe, expect, it } from "vitest";
import type { AvatarCharacter } from "api-server-api/avatar/svg";
import { toProgress } from "../../modules/getting-started/domain/unlocks.js";
import type {
  Checklist,
  Unlock,
} from "../../modules/getting-started/domain/unlocks.js";
import type { GettingStartedRepository } from "../../modules/getting-started/infrastructure/getting-started-repository.js";
import { createEnrollment } from "../../modules/getting-started/services/enrollment.js";
import { recordProvisionedAgent } from "../../modules/getting-started/services/first-agent.js";
import { createUnlockRecorder } from "../../modules/getting-started/services/unlock-recorder.js";

const OWNER = "alice";
const AGENT = "agent-00000000000000a1";
const CHARACTER = "compass" as AvatarCharacter;

/** UNIT_BOUNDARY_DESCRIPTION: the checklist tables as PostgreSQL behaves — one row per task per owner, an unseen unlock carrying no `seenAt`. */
function memoryRepo() {
  const checklists = new Map<string, Checklist>();
  const repo = {
    find: async (owner: string) => checklists.get(owner) ?? null,
    enroll: async (owner: string, unlocked: Unlock[]) => {
      if (checklists.has(owner)) return;
      checklists.set(owner, {
        dismissedAt: null,
        unlocks: unlocked.map((u) => ({ ...u, seenAt: new Date() })),
      });
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
    reset: async () => undefined,
  } satisfies GettingStartedRepository;
  return { repo, checklists };
}

function provisioned() {
  const { repo, checklists } = memoryRepo();
  const enrollment = createEnrollment({
    repo,
    ownedAgentIds: async () => [],
  });
  const recorder = createUnlockRecorder({
    repo,
    enrollment,
    random: () => 0,
  });
  return { repo, checklists, recorder };
}

describe("the checklist and the provisioned assistant", () => {
  // TEST_SCENARIO: the pill counts an unseen unlock as not done, so the assistant's first task is recorded and marked seen in one go; the checklist reads one of its tasks done with that character.
  it("records the first agent's task as seen", async () => {
    const { repo, recorder, checklists } = provisioned();
    await recordProvisionedAgent({ recorder, repo }, OWNER, {
      agentId: AGENT,
      character: CHARACTER,
    });

    const progress = toProgress(checklists.get(OWNER)!);
    expect(progress.unlocks).toEqual([
      expect.objectContaining({
        task: "create-agent",
        character: CHARACTER,
        seen: true,
        fresh: false,
      }),
    ]);
  });

  // TEST_SCENARIO: the AgentCreated event that announces the assistant arrives afterwards and finds the task recorded, so it holds no second unlock and the character is not lost.
  it("leaves the announcement with nothing to record", async () => {
    const { repo, recorder } = provisioned();
    await recordProvisionedAgent({ recorder, repo }, OWNER, {
      agentId: AGENT,
      character: CHARACTER,
    });
    expect(
      await repo.unlock(OWNER, "create-agent", () => ({
        character: CHARACTER,
        picked: false,
      })),
    ).toBeNull();
    expect(await repo.find(OWNER)).toMatchObject({
      unlocks: [expect.objectContaining({ task: "create-agent" })],
    });
  });
});
