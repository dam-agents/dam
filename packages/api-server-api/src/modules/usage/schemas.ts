import { z } from "zod";

export const entryPointChoiceSchema = z.enum([
  "sandbox",
  "knowledge-base",
  "starter-kit",
]);

export const entryPointChosenInputSchema = z.object({
  choice: entryPointChoiceSchema,
});

export const USAGE_REPORT_FRAME = { ready: "ready", theme: "theme" } as const;

export const usageReportFrameReadySchema = z.object({
  type: z.literal(USAGE_REPORT_FRAME.ready),
});
