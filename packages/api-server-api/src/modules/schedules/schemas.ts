import { z } from "zod";

// "schedule session mode" — how the agent resumes between scheduled
// ticks. Distinct from sessions/types.ts `sessionModeSchema`
// (chat / terminal), which is about the channel kind. Extracted here
// because it appears in three of the schedules input schemas.
const scheduleSessionModeSchema = z.enum(["continuous", "fresh"]);

// Quiet-hours window: inclusive start, exclusive end, in the schedule's
// timezone. endTime < startTime is valid and denotes a crosses-midnight
// window (e.g. 22:00–06:00) — the controller evaluates these as
// [start, 24:00) ∪ [00:00, end). See ADR-031 for semantics.
export const quietWindowSchema = z
  .object({
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM required"),
    endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM required"),
    enabled: z.boolean(),
  })
  .refine((w) => w.startTime !== w.endTime, {
    message: "startTime and endTime must differ",
  });

export const scheduleListInputSchema = z.object({
  agentId: z.string().min(1),
});

export const scheduleGetInputSchema = z.object({
  id: z.string().min(1),
});

export const scheduleCreateCronInputSchema = z.object({
  name: z.string().min(1),
  agentId: z.string().min(1),
  cron: z.string().min(1),
  task: z.string().min(1),
  sessionMode: scheduleSessionModeSchema.optional(),
});

export const scheduleCreateRRuleInputSchema = z.object({
  name: z.string().min(1),
  agentId: z.string().min(1),
  rrule: z.string().min(1),
  timezone: z.string().min(1),
  quietHours: z.array(quietWindowSchema).optional(),
  task: z.string().min(1),
  sessionMode: scheduleSessionModeSchema.optional(),
});

export const scheduleUpdateRRuleInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rrule: z.string().min(1),
  timezone: z.string().min(1),
  quietHours: z.array(quietWindowSchema),
  task: z.string().min(1),
  sessionMode: scheduleSessionModeSchema.optional(),
});

export const scheduleDeleteInputSchema = z.object({
  id: z.string().min(1),
});

export const scheduleToggleInputSchema = z.object({
  id: z.string().min(1),
});

// Loose schema for parsing quiet-hours windows stored in ConfigMaps.
// Looser than the user-input `quietWindowSchema` (no HH:MM regex) so
// existing ConfigMap data parses even if it predates the stricter rules.
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
});
