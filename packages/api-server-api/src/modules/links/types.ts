import { z } from "zod";

export const linksSchema = z.object({
  computeRequest: z.url(),
});

export type Links = z.infer<typeof linksSchema>;
