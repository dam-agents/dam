import {
  type AvatarCharacter,
  AVATAR_CHARACTERS,
} from "api-server-api/avatar/svg";
import {
  GETTING_STARTED_TASKS,
  type GettingStartedProgress,
  type GettingStartedTask,
} from "api-server-api";

export interface Unlock {
  task: GettingStartedTask;
  character: AvatarCharacter;
  unlockedAt: Date;
  seenAt: Date | null;
  pickedAt: Date | null;
}

export interface Checklist {
  dismissedAt: Date | null;
  unlocks: readonly Unlock[];
}

export function chooseCharacter(
  taken: ReadonlySet<AvatarCharacter>,
  preferred: AvatarCharacter | undefined,
  random: () => number,
): AvatarCharacter | null {
  if (preferred && !taken.has(preferred)) return preferred;
  const free = AVATAR_CHARACTERS.filter((c) => !taken.has(c));
  return free[Math.floor(random() * free.length)] ?? null;
}

export function chooseUnlock(
  taken: ReadonlySet<AvatarCharacter>,
  preferred: AvatarCharacter | undefined,
  random: () => number,
): { character: AvatarCharacter; picked: boolean } | null {
  const character = chooseCharacter(taken, preferred, random);
  return character && { character, picked: character === preferred };
}

export function everyUnlock(): Array<{
  task: GettingStartedTask;
  character: AvatarCharacter;
}> {
  return GETTING_STARTED_TASKS.map((task, i) => ({
    task,
    character: AVATAR_CHARACTERS[i % AVATAR_CHARACTERS.length]!,
  }));
}

export function toProgress(checklist: Checklist): GettingStartedProgress {
  return {
    unlocks: [...checklist.unlocks]
      .sort((a, b) => a.unlockedAt.getTime() - b.unlockedAt.getTime())
      .map((u) => ({
        task: u.task,
        character: u.character,
        unlockedAt: u.unlockedAt.toISOString(),
        seen: u.seenAt !== null,
        fresh: u.pickedAt === null,
      })),
    dismissed: checklist.dismissedAt !== null,
  };
}
