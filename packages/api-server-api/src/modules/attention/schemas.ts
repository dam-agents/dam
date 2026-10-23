import { z } from "zod";

import { ATTENTION_FEED_LIMIT } from "./types.js";

export const attentionSessionsForAgentInputSchema = z.object({
  agentId: z.string().min(1),
});

export const attentionListForOwnerPageInputSchema = z.object({
  after: z
    .object({
      activityAt: z.string(),
      sessionId: z.string().min(1),
    })
    .optional(),
  limit: z.number().int().min(1).max(ATTENTION_FEED_LIMIT).optional(),
});

export const attentionDismissInputSchema = z.object({
  items: z
    .array(
      z.object({
        kind: z.enum(["session", "approval", "default-model", "outage-alert"]),
        id: z.string().trim().min(1).max(512),
      }),
    )
    .min(1)
    .max(200),
});
