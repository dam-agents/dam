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
