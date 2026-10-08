import { z } from "zod";

export const podSessionModeSchema = z.enum(["chat", "terminal"]);

export const podSessionTypeSchema = z.enum([
  "regular",
  "channel_slack",
  "channel_telegram",
  "schedule_cron",
  "schedule_once",
  "cli_run",
]);

export const sessionSpendSchema = z.object({
  unit: z.string().min(1),
  cost: z.number(),
});

export const podSessionSchema = z.object({
  sessionId: z.string().min(1),
  mode: podSessionModeSchema,
  type: podSessionTypeSchema.catch("regular"),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
  title: z.string().nullable(),
  scheduleId: z.string().nullable(),
  initialization: z.boolean().optional(),
  threadTs: z.string().nullable(),
  seenAt: z.string().nullable(),
  runStartedAt: z.string().nullable(),
  runTotalMs: z.number().nullable(),
  runCount: z.number().nullable(),
  running: z.boolean(),
  spend: sessionSpendSchema.optional(),
});

export const SESSION_CATEGORIES = [
  "chats",
  "scheduled",
  "channels",
  "runs",
  "terminal",
] as const;

export const sessionCategorySchema = z.enum(SESSION_CATEGORIES);

export const SESSION_LIST_MAX_LIMIT = 200;

export const sessionListCursorSchema = z.object({
  activityAt: z.string(),
  sessionId: z.string().min(1),
});

export const sessionListInputSchema = z
  .object({
    categories: z.array(sessionCategorySchema).optional(),
    sessionId: z.string().min(1).optional(),
    scheduleId: z.string().min(1).optional(),
    after: sessionListCursorSchema.optional(),
    limit: z.number().int().min(1).max(SESSION_LIST_MAX_LIMIT).optional(),
  })
  .optional();

export const SESSION_TITLE_MAX_LENGTH = 200;

export const sessionTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(SESSION_TITLE_MAX_LENGTH);

export const setSessionTitleInputSchema = z.union([
  z.object({
    sessionId: z.string().min(1),
    title: sessionTitleSchema.nullable(),
  }),
  z.object({ ref: z.string().min(1), title: sessionTitleSchema.nullable() }),
]);

export const sessionSpendInputSchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
});

export const sessionHistoryInputSchema = z.object({
  sessionId: z.string().min(1),
});

export const sessionHistorySchema = z.object({
  frames: z.array(z.string()),
  truncated: z.boolean(),
});

export const delegationIdSchema = z.string().regex(/^agent-[a-z0-9]+$/);

export const delegationFramesInputSchema = z.object({
  invocationId: delegationIdSchema,
});

export const storeDelegationFramesInputSchema = z.object({
  invocationId: delegationIdSchema,
  frames: z.array(z.string()),
});

export const delegationFramesSchema = z.object({
  frames: z.array(z.string()),
});

export const podSessionNoticeSchema = z.object({
  topic: z.literal("sessions"),
});

export const sessionDirectoryEntrySchema = z.object({
  sessionId: z.string().min(1),
  mode: podSessionModeSchema,
  type: podSessionTypeSchema.catch("regular"),
  createdAt: z.string(),
});

export const sessionDirectoryReportSchema = z.object({
  protocolVersion: z.literal("v1"),
  sessions: z.array(sessionDirectoryEntrySchema).max(10_000),
});
