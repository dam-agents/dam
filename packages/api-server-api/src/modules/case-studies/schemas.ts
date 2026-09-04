import { z } from "zod";
import { CASE_STUDY_CONTENT_MAX_CHARS } from "./constants.js";
import type {
  CaseStudyInspectionFilter,
  CaseStudyInspectionFilterInput,
} from "./types.js";

export const caseStudyStatusSchema = z.enum([
  "pending",
  "released",
  "hidden",
  "deleted",
]);

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const caseStudyIdInputSchema = z.object({
  id: z.string().min(1),
});

export const caseStudyContentSchema = z
  .string()
  .min(1)
  .max(CASE_STUDY_CONTENT_MAX_CHARS);

export const caseStudySubmitInputSchema = z.object({
  content: caseStudyContentSchema,
  window_start: isoDateSchema,
  window_end: isoDateSchema,
  artifact_id: z.string().min(1).optional(),
});

const calendarDateSchema = isoDateSchema.refine((value) => {
  const parsed = new Date(value);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}, "not a real calendar date");

export const caseStudyInspectionFilterSchema = z.object({
  since: z
    .string()
    .datetime()
    .optional()
    .describe("Only editions updated at or after this ISO date-time."),
  week_of: calendarDateSchema
    .optional()
    .describe(
      "Only editions of the week containing this date (YYYY-MM-DD, any day of that week).",
    ),
  agent_id: z
    .string()
    .min(1)
    .optional()
    .describe("Only editions submitted by this agent."),
});

export function toCaseStudyInspectionFilter(
  input: CaseStudyInspectionFilterInput,
): CaseStudyInspectionFilter {
  return {
    since: input.since === undefined ? undefined : new Date(input.since),
    weekOf: input.week_of === undefined ? undefined : new Date(input.week_of),
    agentId: input.agent_id,
  };
}
