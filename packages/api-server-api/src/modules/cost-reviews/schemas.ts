import { z } from "zod";

export const costReviewStartInputSchema = z.object({
  agentId: z.string().min(1),
});

export const costReviewDismissInputSchema = z.object({
  agentIds: z.array(z.string().min(1)).min(1).max(200),
});
