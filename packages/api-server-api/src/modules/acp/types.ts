import { z } from "zod";

import { sessionModeSchema } from "../sessions/types.js";

// --- platform/turnEnded ----------------------------------------------------

export const platformTurnEndedParamsSchema = z.object({
  sessionId: z.string().min(1),
});
export type PlatformTurnEndedParams = z.infer<
  typeof platformTurnEndedParamsSchema
>;

export const platformTurnEndedNotificationSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.literal("platform/turnEnded"),
  params: platformTurnEndedParamsSchema,
});
export type PlatformTurnEndedNotification = z.infer<
  typeof platformTurnEndedNotificationSchema
>;

export function buildPlatformTurnEndedNotification(
  params: PlatformTurnEndedParams,
): PlatformTurnEndedNotification {
  return platformTurnEndedNotificationSchema.parse({
    jsonrpc: "2.0",
    method: "platform/turnEnded",
    params,
  });
}

// --- platform/sessionModeChanged ------------------------------------------

export const platformSessionModeChangedParamsSchema = z.object({
  sessionId: z.string().min(1),
  mode: sessionModeSchema,
});
export type PlatformSessionModeChangedParams = z.infer<
  typeof platformSessionModeChangedParamsSchema
>;

export const platformSessionModeChangedNotificationSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.literal("platform/sessionModeChanged"),
  params: platformSessionModeChangedParamsSchema,
});
export type PlatformSessionModeChangedNotification = z.infer<
  typeof platformSessionModeChangedNotificationSchema
>;

export function buildPlatformSessionModeChangedNotification(
  params: PlatformSessionModeChangedParams,
): PlatformSessionModeChangedNotification {
  return platformSessionModeChangedNotificationSchema.parse({
    jsonrpc: "2.0",
    method: "platform/sessionModeChanged",
    params,
  });
}
