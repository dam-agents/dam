import { z } from "zod";

// Browser-safe Zod schemas for the connections module. Lives in its own
// file so UI code can import these without dragging in @trpc/server
// transitively via router.ts.

export const connectionGetAgentConnectionsInputSchema = z.object({
  agentId: z.string().min(1),
});

export const connectionSetAgentConnectionsInputSchema = z.object({
  agentId: z.string().min(1),
  connectionIds: z.array(z.string().min(1)),
});
