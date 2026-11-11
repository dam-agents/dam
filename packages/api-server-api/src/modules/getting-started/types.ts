import type { z } from "zod";

import type { AvatarCharacter } from "../agents/avatar/svg.js";

import type {
  avatarUnlockSchema,
  gettingStartedProgressSchema,
  gettingStartedTaskSchema,
} from "./schemas.js";

export type GettingStartedTask = z.infer<typeof gettingStartedTaskSchema>;

export type AvatarUnlock = z.infer<typeof avatarUnlockSchema>;

export type GettingStartedProgress = z.infer<
  typeof gettingStartedProgressSchema
>;

export interface GettingStartedService {
  progress(): Promise<GettingStartedProgress>;
  markUnlockSeen(task: GettingStartedTask): Promise<GettingStartedProgress>;
  markAvatarPicked(character: AvatarCharacter): Promise<GettingStartedProgress>;
  setDismissed(dismissed: boolean): Promise<GettingStartedProgress>;
}
