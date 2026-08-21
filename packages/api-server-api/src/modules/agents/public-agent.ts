import { z } from "zod";

export const publicAgentViewSchema = z.object({
  agentId: z.string(),
  name: z.string(),
  ownerEmail: z.string().nullable(),
});

export type PublicAgentView = z.infer<typeof publicAgentViewSchema>;

export const publicAgentResponseSchema = z.object({
  agent: publicAgentViewSchema.nullable(),
});

export type PublicAgentResponse = z.infer<typeof publicAgentResponseSchema>;
