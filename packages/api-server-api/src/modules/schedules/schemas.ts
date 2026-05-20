import { z } from "zod";

const quietWindowSchema = z.object({
  startTime: z.string(),
  endTime: z.string(),
  enabled: z.boolean(),
});

const scheduleCreatorSchema = z.enum(["user", "agent"]);

const sessionModeSchema = z.enum(["continuous", "fresh"]).optional();

const scheduleSpecCronSchema = z
  .object({
    version: z.string(),
    type: z.literal("cron"),
    cron: z.string(),
    task: z.string().optional(),
    enabled: z.boolean(),
    sessionMode: sessionModeSchema,
    createdBy: scheduleCreatorSchema,
  })
  .passthrough();

const scheduleSpecRRuleSchema = z
  .object({
    version: z.string(),
    type: z.literal("rrule"),
    rrule: z.string(),
    timezone: z.string(),
    quietHours: z.array(quietWindowSchema).optional(),
    task: z.string().optional(),
    enabled: z.boolean(),
    sessionMode: sessionModeSchema,
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

// --- Router input schemas ---

const quietWindowInputSchema = z
  .object({
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM required"),
    endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM required"),
    enabled: z.boolean(),
  })
  .refine((w) => w.startTime !== w.endTime, {
    message: "startTime and endTime must differ",
  });

export const createCronInputSchema = z.object({
  name: z.string().min(1),
  agentId: z.string().min(1),
  cron: z.string().min(1),
  task: z.string().min(1),
  sessionMode: z.enum(["continuous", "fresh"]).optional(),
});

export type CreateCronInput = z.infer<typeof createCronInputSchema>;

export const createRRuleInputSchema = z.object({
  name: z.string().min(1),
  agentId: z.string().min(1),
  rrule: z.string().min(1),
  timezone: z.string().min(1),
  quietHours: z.array(quietWindowInputSchema).optional(),
  task: z.string().min(1),
  sessionMode: z.enum(["continuous", "fresh"]).optional(),
});

export type CreateRRuleInput = z.infer<typeof createRRuleInputSchema>;

export const updateRRuleInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rrule: z.string().min(1),
  timezone: z.string().min(1),
  quietHours: z.array(quietWindowInputSchema),
  task: z.string().min(1),
  sessionMode: z.enum(["continuous", "fresh"]).optional(),
});

export type UpdateRRuleInput = z.infer<typeof updateRRuleInputSchema>;
