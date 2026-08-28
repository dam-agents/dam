import { z } from "zod";

export const podSessionModeSchema = z.enum(["chat", "terminal"]);

export const podSessionTypeSchema = z.enum([
  "regular",
  "channel_slack",
  "channel_telegram",
  "schedule_cron",
  "experiment_execute",
]);

export const podSessionSchema = z.object({
  sessionId: z.string().min(1),
  mode: podSessionModeSchema,
  type: podSessionTypeSchema,
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
  title: z.string().nullable(),
  scheduleId: z.string().nullable(),
  experimentId: z.string().nullable(),
  threadTs: z.string().nullable(),
  seenAt: z.string().nullable(),
  running: z.boolean(),
});

export const podSessionListSchema = z.object({
  sessions: z.array(podSessionSchema),
});

export const podSessionNoticeSchema = z.object({
  topic: z.literal("sessions"),
});
