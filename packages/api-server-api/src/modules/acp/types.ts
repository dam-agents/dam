import { z } from "zod";

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

// --- platform/promptAccepted ------------------------------------------------

export const platformPromptAcceptedParamsSchema = z.object({
  sessionId: z.string().min(1),
  promptId: z.string().min(1),
  /** True when the prompt was parked behind an in-flight turn. */
  queued: z.boolean(),
});
export type PlatformPromptAcceptedParams = z.infer<
  typeof platformPromptAcceptedParamsSchema
>;

export const platformPromptAcceptedNotificationSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.literal("platform/promptAccepted"),
  params: platformPromptAcceptedParamsSchema,
});
export type PlatformPromptAcceptedNotification = z.infer<
  typeof platformPromptAcceptedNotificationSchema
>;

export function buildPlatformPromptAcceptedNotification(
  params: PlatformPromptAcceptedParams,
): PlatformPromptAcceptedNotification {
  return platformPromptAcceptedNotificationSchema.parse({
    jsonrpc: "2.0",
    method: "platform/promptAccepted",
    params,
  });
}

// --- platform/promptStarted -------------------------------------------------

export const platformPromptStartedParamsSchema = z.object({
  sessionId: z.string().min(1),
  promptId: z.string().min(1),
});
export type PlatformPromptStartedParams = z.infer<
  typeof platformPromptStartedParamsSchema
>;

export const platformPromptStartedNotificationSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.literal("platform/promptStarted"),
  params: platformPromptStartedParamsSchema,
});
export type PlatformPromptStartedNotification = z.infer<
  typeof platformPromptStartedNotificationSchema
>;

export function buildPlatformPromptStartedNotification(
  params: PlatformPromptStartedParams,
): PlatformPromptStartedNotification {
  return platformPromptStartedNotificationSchema.parse({
    jsonrpc: "2.0",
    method: "platform/promptStarted",
    params,
  });
}
