import { z } from "zod";

export const SECURITY_CHECK_MAX_PROBLEMS = 20;
export const SECURITY_CHECK_PROBLEM_MAX_LENGTH = 200;

export const securityCheckReportInputSchema = z.object({
  problems: z
    .array(z.string().trim().min(1).max(SECURITY_CHECK_PROBLEM_MAX_LENGTH))
    .max(SECURITY_CHECK_MAX_PROBLEMS),
  update: z.boolean().optional(),
});

export const securityCheckLevelSchema = z.enum([
  "off",
  "low",
  "medium",
  "high",
  "deep",
]);

export const securityCheckSetLevelInputSchema = z.object({
  level: securityCheckLevelSchema,
});
