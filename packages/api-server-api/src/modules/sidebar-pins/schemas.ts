import { z } from "zod";

export const SIDEBAR_PINS_MAX = 100;

const pinnedIdSchema = z.string().trim().min(1).max(256);

export const sidebarPinsSchema = z.object({
  agents: z.array(z.string()),
  sessions: z.record(z.string(), z.array(z.string())),
});

export const sidebarPinAgentsInputSchema = z.object({
  agentIds: z.array(pinnedIdSchema).max(SIDEBAR_PINS_MAX),
});

export const sidebarPinSessionsInputSchema = z.object({
  agentId: pinnedIdSchema,
  sessionIds: z.array(pinnedIdSchema).max(SIDEBAR_PINS_MAX),
});
