import { z } from "zod";

import { AVATAR_CHARACTERS } from "../agents/avatar/svg.js";

export const GETTING_STARTED_TASKS = [
  "create-agent",
  "send-message",
  "create-connection",
  "add-skill",
  "apply-starter-kit",
  "create-schedule",
  "create-artifact",
  "connect-slack",
] as const;

export const gettingStartedTaskSchema = z.enum(GETTING_STARTED_TASKS);

export const avatarUnlockSchema = z.object({
  task: gettingStartedTaskSchema,
  character: z.enum(AVATAR_CHARACTERS),
  unlockedAt: z.string(),
  seen: z.boolean(),
  fresh: z.boolean(),
});

export const gettingStartedProgressSchema = z.object({
  unlocks: z.array(avatarUnlockSchema),
  dismissed: z.boolean(),
});

export const markUnlockSeenInputSchema = z.object({
  task: gettingStartedTaskSchema,
});

export const markAvatarPickedInputSchema = z.object({
  character: z.enum(AVATAR_CHARACTERS),
});

export const setChecklistDismissedInputSchema = z.object({
  dismissed: z.boolean(),
});
