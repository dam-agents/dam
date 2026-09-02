import { z } from "zod";

export const linksSchema = z.object({
  computeRequest: z.string().nullable(),
});

export type Links = z.infer<typeof linksSchema>;
