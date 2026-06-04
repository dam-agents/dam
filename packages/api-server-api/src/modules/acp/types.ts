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
