import { z } from "zod";

export const linksSchema = z.object({
  docs: z.string().nullable(),
  computeRequest: z.string().nullable(),
  curveBenderCommunity: z.string().nullable(),
  slackInstallRequest: z.string().nullable(),
});

export type Links = z.infer<typeof linksSchema>;
