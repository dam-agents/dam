import { z } from "zod";

export const SIDEBAR_ORDER_MAX = 1000;

const orderedIdSchema = z.string().trim().min(1).max(256);

export const sidebarOrderSchema = z.object({
  agents: z.array(z.string()),
  sessions: z.record(z.string(), z.array(z.string())),
});

export const sidebarOrderAgentsInputSchema = z.object({
  agentIds: z.array(orderedIdSchema).max(SIDEBAR_ORDER_MAX),
});
