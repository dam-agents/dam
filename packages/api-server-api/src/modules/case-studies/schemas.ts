import { z } from "zod";
import { CASE_STUDY_CONTENT_MAX_CHARS } from "./constants.js";

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

export const caseStudySubmitInputSchema = z.object({
  content: z.string().min(1).max(CASE_STUDY_CONTENT_MAX_CHARS),
  window_start: isoDateSchema,
  window_end: isoDateSchema,
  artifact_id: z.string().min(1).optional(),
});
