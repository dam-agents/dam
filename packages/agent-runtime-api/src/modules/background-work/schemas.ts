import { z } from "zod/v4";

const advisory = (max: number) =>
  z
    .string()
    .transform((text) => text.slice(0, max))
    .optional();

export const backgroundWorkItemSchema = z.object({
  id: z
    .string()
    .min(1)
    .transform((id) => id.slice(0, 128)),
  description: advisory(200),
  command: advisory(500),
});

export const backgroundWorkReportSchema = z.object({
  items: z
    .array(backgroundWorkItemSchema)
    .transform((items) => items.slice(0, 64)),
});
