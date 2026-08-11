import { z } from "zod";

// --- prompt rejections -----------------------------------------------------

/** `data.code` on the runtime's queue-full rejection. JSON-RPC's application
 *  range gives one catch-all code for every cause, so the cause rides here. */
export const PROMPT_QUEUE_FULL_CODE = "PROMPT_QUEUE_FULL";

/** The rejection's message stem, shared so neither side can reword it alone —
 *  older runtimes are recognised by this text, not by the code above. */
export const PROMPT_QUEUE_FULL_MESSAGE = "prompt queue full";

export const jsonRpcIdSchema = z.union([z.string(), z.number()]);
export type JsonRpcId = z.infer<typeof jsonRpcIdSchema>;

export const promptQueueFullDataSchema = z.object({
  code: z.literal(PROMPT_QUEUE_FULL_CODE),
});
export type PromptQueueFullData = z.infer<typeof promptQueueFullDataSchema>;

export const promptQueueFullErrorSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: jsonRpcIdSchema,
  error: z.object({
    code: z.literal(-32000),
    message: z.string().min(1),
    data: promptQueueFullDataSchema,
  }),
});
export type PromptQueueFullError = z.infer<typeof promptQueueFullErrorSchema>;

export function buildPromptQueueFullError(
  id: JsonRpcId,
  sessionId: string,
): PromptQueueFullError {
  return promptQueueFullErrorSchema.parse({
    jsonrpc: "2.0",
    id,
    error: {
      code: -32000,
      message: `${PROMPT_QUEUE_FULL_MESSAGE} for session ${sessionId}`,
      data: { code: PROMPT_QUEUE_FULL_CODE },
    },
  });
}

/** Whether a JSON-RPC error's `data` slot names the queue-full cause. */
export function isPromptQueueFullData(data: unknown): boolean {
  return promptQueueFullDataSchema.safeParse(data).success;
}

// --- channel close reasons -------------------------------------------------

/** The reasons the runtime closes an engaged channel because the agent itself
 *  went away. A turn closed for one of these does not survive to be replayed,
 *  which is what lets a sender tell a lost turn from a lost view. Relays
 *  substitute their own text when the upstream gave none, so presence of a
 *  reason proves nothing — only membership here does. */
export const AGENT_STOP_CLOSE_REASONS = [
  "agent exited",
  "agent recycled for env change",
  "agent process is not running",
] as const;

export function isAgentStopCloseReason(
  reason: string | null,
): reason is string {
  return (
    reason !== null &&
    (AGENT_STOP_CLOSE_REASONS as readonly string[]).includes(reason)
  );
}

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
