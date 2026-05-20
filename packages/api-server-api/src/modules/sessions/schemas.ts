import { z } from "zod";
import { SessionMode, SessionType, sessionModeSchema } from "./types.js";

export const sessionTypeSchema = z.enum([
  SessionType.Regular,
  SessionType.ChannelSlack,
  SessionType.ChannelTelegram,
  SessionType.ScheduleCron,
]);

export const createSessionInputSchema = z.object({
  sessionId: z.string().min(1),
  agentId: z.string().min(1),
  type: sessionTypeSchema.optional(),
  scheduleId: z.string().optional(),
  mode: sessionModeSchema.default(SessionMode.Chat),
});

export type CreateSessionInput = z.infer<typeof createSessionInputSchema>;

export const resolveTerminalInputSchema = z.object({
  agentId: z.string().min(1),
  strategy: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("new") }),
    z.object({ kind: z.literal("continue") }),
    z.object({ kind: z.literal("resume"), sessionId: z.string().min(1) }),
  ]),
  reset: z.boolean().optional(),
  force: z.boolean().optional(),
});

export type ResolveTerminalInput = z.infer<typeof resolveTerminalInputSchema>;
