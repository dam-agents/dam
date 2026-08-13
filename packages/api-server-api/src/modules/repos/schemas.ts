import { z } from "zod";

export const repoSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.url(),
  ref: z.string().min(1).optional(),
  description: z.string().optional(),
  compatibleTemplates: z.array(z.string()).default([]),
});
