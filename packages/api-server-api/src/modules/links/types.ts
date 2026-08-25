import { z } from "zod";

export const linksSchema = z.object({
  computeRequest: z.url().nullable(),
});

export type Links = z.infer<typeof linksSchema>;
