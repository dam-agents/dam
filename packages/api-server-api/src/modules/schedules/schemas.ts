import { z } from "zod";

const scheduleSessionModeSchema = z.enum(["continuous", "fresh"]);

export const quietWindowSchema = z
  .object({
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM required"),
    endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM required"),
    enabled: z.boolean(),
  })
  .refine((w) => w.startTime !== w.endTime, {
    message: "startTime and endTime must differ",
  });

export const scheduleListForOwnerInputSchema = z
  .object({ limit: z.number().int().positive().max(200).optional() })
  .optional();

export const scheduleListInputSchema = z.object({
  agentId: z.string().min(1),
});

export const scheduleGetInputSchema = z.object({
  id: z.string().min(1),
});

export const PRECHECK_MAX_LENGTH = 8_000;

export const precheckSchema = z.string().trim().min(1).max(PRECHECK_MAX_LENGTH);

export const scheduleCreateCronInputSchema = z.object({
  name: z.string().min(1),
  agentId: z.string().min(1),
  cron: z.string().min(1),
  task: z.string().min(1),
  sessionMode: scheduleSessionModeSchema.optional(),
  precheck: precheckSchema.optional(),
});

export const scheduleCreateRRuleInputSchema = z.object({
  name: z.string().min(1),
  agentId: z.string().min(1),
  rrule: z.string().min(1),
  timezone: z.string().min(1),
  quietHours: z.array(quietWindowSchema).optional(),
  task: z.string().min(1),
  sessionMode: scheduleSessionModeSchema.optional(),
  precheck: precheckSchema.optional(),
});

export const scheduleUpdateRRuleInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rrule: z.string().min(1),
  timezone: z.string().min(1),
  quietHours: z.array(quietWindowSchema),
  task: z.string().min(1),
  sessionMode: scheduleSessionModeSchema.optional(),
  precheck: precheckSchema.nullable().optional(),
});

export const scheduleDeleteInputSchema = z.object({
  id: z.string().min(1),
});

export const scheduleToggleInputSchema = z.object({
  id: z.string().min(1),
});

export const scheduleResetSessionInputSchema = z.object({
  id: z.string().min(1),
});

const quietWindowConfigMapSchema = z.object({
  startTime: z.string(),
  endTime: z.string(),
  enabled: z.boolean(),
});

const scheduleCreatorSchema = z.enum(["user", "agent"]);

const scheduleSpecCronSchema = z
  .object({
    version: z.string(),
    type: z.literal("cron"),
    cron: z.string(),
    task: z.string().optional(),
    precheck: precheckSchema.optional(),
    enabled: z.boolean(),
    sessionMode: scheduleSessionModeSchema.optional(),
    createdBy: scheduleCreatorSchema,
  })
  .passthrough();

const scheduleSpecRRuleSchema = z
  .object({
    version: z.string(),
    type: z.literal("rrule"),
    rrule: z.string(),
    timezone: z.string(),
    quietHours: z.array(quietWindowConfigMapSchema).optional(),
    task: z.string().optional(),
    precheck: precheckSchema.optional(),
    enabled: z.boolean(),
    sessionMode: scheduleSessionModeSchema.optional(),
    createdBy: scheduleCreatorSchema,
  })
  .passthrough();

export const scheduleSpecSchema = z.discriminatedUnion("type", [
  scheduleSpecCronSchema,
  scheduleSpecRRuleSchema,
]);

export const scheduleStatusSchema = z.object({
  lastRun: z.string().optional(),
  nextRun: z.string().optional(),
  lastResult: z.string().optional(),
  lastDeclinedAt: z.string().optional(),
  declinedCount: z.number().int().nonnegative().optional(),
  lastPrecheckError: z.string().optional(),
  precheckFailedCount: z.number().int().nonnegative().optional(),
});

export const precheckVerdictSchema = z.enum([
  "allowed",
  "declined",
  "precheck-failed",
]);

export const scheduleFireReportInputSchema = z.object({
  scheduleId: z.string().min(1),
  fireAt: z.string().datetime({ offset: true }),
  verdict: precheckVerdictSchema,
  detail: z.string().max(2_000).optional(),
});
