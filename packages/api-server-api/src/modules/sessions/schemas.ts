import { z } from "zod";
import { SessionMode, SessionType, sessionModeSchema } from "./types.js";

const sessionTypeSchema = z.enum([
  SessionType.Regular,
  SessionType.ChannelSlack,
  SessionType.ChannelTelegram,
  SessionType.ScheduleCron,
]);

export const terminalStrategySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new") }),
  z.object({ kind: z.literal("continue") }),
  z.object({ kind: z.literal("resume"), sessionId: z.string().min(1) }),
]);

export const sessionListInputSchema = z.object({
  agentId: z.string().min(1),
  includeChannel: z.boolean().optional(),
});

export const sessionCreateInputSchema = z.object({
  sessionId: z.string().min(1),
  agentId: z.string().min(1),
  type: sessionTypeSchema.optional(),
  scheduleId: z.string().optional(),
  // Default at the API edge so existing clients omitting `mode` still
  // land at "chat"; internal callers receive a concrete SessionMode.
  mode: sessionModeSchema.default(SessionMode.Chat),
});

export const sessionSetModeInputSchema = z.object({
  sessionId: z.string().min(1),
  agentId: z.string().min(1),
  mode: sessionModeSchema,
});

export const sessionDeleteInputSchema = z.object({
  sessionId: z.string().min(1),
  agentId: z.string().min(1),
});

export const sessionListByScheduleIdInputSchema = z.object({
  scheduleId: z.string().min(1),
});

export const sessionResetByScheduleIdInputSchema = z.object({
  scheduleId: z.string().min(1),
});

export const sessionResolveTerminalInputSchema = z.object({
  agentId: z.string().min(1),
  strategy: terminalStrategySchema,
  reset: z.boolean().optional(),
  force: z.boolean().optional(),
});
