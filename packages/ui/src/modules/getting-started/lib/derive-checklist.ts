import {
  type AvatarUnlock,
  GETTING_STARTED_TASKS,
  type GettingStartedProgress,
  type GettingStartedTask,
} from "api-server-api";
import type { AvatarCharacter } from "api-server-api/avatar/svg";

export interface ChecklistRow {
  task: GettingStartedTask;
  reward: AvatarCharacter | null;
}

export type UnlockVariant = "first-agent" | "new" | "last";

export interface Checklist {
  rows: ChecklistRow[];
  unlocked: AvatarCharacter[];
  celebrating: { unlock: AvatarUnlock; variant: UnlockVariant } | null;
  complete: boolean;
  dismissed: boolean;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Turns the server's progress into what the checklist
 * shows. An unlock the user has not seen yet is celebrated before it counts
 * as done, one at a time and oldest first, so a starter kit that finishes
 * several tasks at once still shows each new character.
 */
export function deriveChecklist(progress: GettingStartedProgress): Checklist {
  const seen = progress.unlocks.filter((u) => u.seen);
  const next = progress.unlocks.find((u) => !u.seen) ?? null;
  const rewardOf = new Map(seen.map((u) => [u.task, u.character]));
  const lastOne =
    next !== null &&
    progress.unlocks.length === GETTING_STARTED_TASKS.length &&
    progress.unlocks.filter((u) => !u.seen).length === 1;
  return {
    rows: GETTING_STARTED_TASKS.map((task) => ({
      task,
      reward: rewardOf.get(task) ?? null,
    })),
    unlocked: seen.map((u) => u.character),
    celebrating: next && {
      unlock: next,
      variant: lastOne
        ? "last"
        : next.task === "create-agent" && !next.fresh
          ? "first-agent"
          : "new",
    },
    complete: seen.length === GETTING_STARTED_TASKS.length,
    dismissed: progress.dismissed,
  };
}
