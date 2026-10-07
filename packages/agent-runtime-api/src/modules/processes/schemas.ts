import { z } from "zod";

export const PROCESS_OUTPUT_MAX_BYTES = 64 * 1024;

export const processKindSchema = z.enum(["turn", "harness-task", "detached"]);

export const keepSourceSchema = z.enum(["default", "agent", "user"]);

export const processRowSchema = z.object({
  key: z.string(),
  kind: processKindSchema,
  pid: z.number().int().nullable(),
  command: z.string(),
  startedAt: z.string(),
  cpuPercent: z.number().nullable(),
  rssBytes: z.number().nullable(),
  outputPath: z.string().nullable(),
  keepsAwake: z.boolean(),
  keepSource: keepSourceSchema,
});

export const finishedRowSchema = z.object({
  key: z.string(),
  kind: z.enum(["harness-task", "detached"]),
  command: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  endedBy: z.enum(["exit", "stop", "hibernation"]),
  outputPath: z.string().nullable(),
  keptAwake: z.boolean(),
  keepSource: keepSourceSchema,
});

export const pendingRestartSchema = z.object({
  reason: z.enum(["env-recycle", "config-recycle"]),
  since: z.string(),
  blockingTasks: z.number().int(),
});

export const processListSchema = z.object({
  running: z.array(processRowSchema),
  finished: z.array(finishedRowSchema),
  pendingRestart: pendingRestartSchema.nullable(),
});

export const processKeyInputSchema = z.object({
  key: z.string().min(1).max(512),
});

export const processOutputSchema = z.object({
  text: z.string(),
  truncated: z.boolean(),
});

export const processNoticeSchema = z.object({
  topic: z.literal("processes"),
});
