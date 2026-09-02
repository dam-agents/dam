import { z } from "zod";

export const liveEventSchema = z.discriminatedUnion("topic", [
  z.object({ topic: z.literal("sync") }),

  z.object({ topic: z.literal("approvals"), agentId: z.string().min(1) }),
  z.object({ topic: z.literal("agents"), agentId: z.string().min(1) }),
  z.object({ topic: z.literal("schedules"), agentId: z.string().min(1) }),
  z.object({ topic: z.literal("harnessConfig"), agentId: z.string().min(1) }),
  z.object({ topic: z.literal("kbShares"), agentId: z.string().min(1) }),

  z.object({
    topic: z.literal("experiments"),
    experimentId: z.string().min(1),
    agentId: z.string().min(1),
  }),

  z.object({
    topic: z.literal("artifacts"),
    artifactId: z.string().min(1).optional(),
    agentId: z.string().min(1).optional(),
  }),
]);

export type LiveEvent = z.infer<typeof liveEventSchema>;

export const podSessionsNoticeSchema = z.discriminatedUnion("topic", [
  z.object({ topic: z.literal("sync") }),
  z.object({ topic: z.literal("sessions"), agentId: z.string().min(1) }),
]);
