import { z } from "zod";

export const attentionSessionsForAgentInputSchema = z.object({
  agentId: z.string().min(1),
});

export const attentionDismissInputSchema = z.object({
  items: z
    .array(
      z.object({
        kind: z.enum(["session", "approval"]),
        id: z.string().trim().min(1).max(512),
      }),
    )
    .min(1)
    .max(200),
});
