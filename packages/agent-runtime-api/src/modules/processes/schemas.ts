import { z } from "zod";

export const PROCESS_OUTPUT_MAX_BYTES = 64 * 1024;

export const processKindSchema = z.enum([
  "turn",
  "harness-task",
  "detached",
  "startup-item",
]);

export const keepSourceSchema = z.enum(["default", "agent", "user"]);

export const containerEngineSchema = z.enum(["docker", "k3s", "containerd"]);

export const processContainerSchema = z.discriminatedUnion("role", [
  z.object({
    role: z.literal("container"),
    engine: containerEngineSchema,
    id: z.string(),
  }),
  z.object({
    role: z.literal("runtime"),
    engine: containerEngineSchema,
  }),
]);

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
  container: processContainerSchema.nullable().default(null),
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
  container: processContainerSchema.nullable().default(null),
});

export const pendingRestartSchema = z.object({
  reason: z.enum(["env-recycle", "config-recycle"]),
  since: z.string(),
  blockingTasks: z.number().int(),
  stops: z.object({
    tasks: z.number().int(),
    turns: z.number().int(),
  }),
});

export const startupItemIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);

export const startupItemDeclarationSchema = z.object({
  name: startupItemIdSchema,
  description: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[^\r\n]*$/, "one line")
    .optional(),
  command: z
    .string()
    .regex(
      /^(?:(?!\.\.?$)[A-Za-z0-9._+-]+|~?(?:\/(?!\.\.?(?:\/|$))[A-Za-z0-9._+-]+)+)$/,
      "a program: a name on PATH, an absolute path, or a path in the agent's home as ~/…",
    ),
  args: z
    .array(z.string().regex(/^[^\r\n\0]*$/, "one line"))
    .max(50)
    .default([]),
  enabled: z.boolean().default(true),
});

export const startupItemSchema = z.object({
  id: startupItemIdSchema,
  command: z.string(),
  disabled: z.boolean(),
  running: z.boolean(),
  listed: z.boolean().default(true),
  outputPath: z.string(),
});

export const processListSchema = z.object({
  running: z.array(processRowSchema),
  finished: z.array(finishedRowSchema),
  pendingRestart: pendingRestartSchema.nullable(),
  startupItems: z.array(startupItemSchema).default([]),
});

export const processKeyInputSchema = z.object({
  key: z.string().min(1).max(512),
});

export const setKeepInputSchema = processKeyInputSchema.extend({
  keepsAwake: z.boolean(),
});

export const startupItemInputSchema = z.object({
  id: startupItemIdSchema,
});

export const setStartupItemEnabledInputSchema = startupItemInputSchema.extend({
  enabled: z.boolean(),
});

const markedPidSchema = z.number().int().positive();

export const keepMarkRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("launch"),
    markId: z.string().min(8).max(128),
    pid: markedPidSchema,
  }),
  z.object({
    kind: z.literal("pid"),
    pid: markedPidSchema,
    callerPid: markedPidSchema,
  }),
]);

export const processOutputSchema = z.object({
  text: z.string(),
  truncated: z.boolean(),
});

export const processNoticeSchema = z.object({
  topic: z.literal("processes"),
});
