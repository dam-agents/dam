import {
  platformPromptAcceptedParamsSchema,
  platformPromptStartedParamsSchema,
  platformTurnEndedParamsSchema,
} from "api-server-api";
import type { z } from "zod";

import type { AcpUpdate } from "./types.js";

export function replayForOf(meta: unknown): string | undefined {
  if (typeof meta !== "object" || meta === null) return undefined;
  const platform = (meta as Record<string, unknown>).platform;
  if (typeof platform !== "object" || platform === null) return undefined;
  const replayFor = (platform as Record<string, unknown>).replayFor;
  return typeof replayFor === "string" ? replayFor : undefined;
}

function parseExtParams<T>(
  method: string,
  schema: z.ZodType<T>,
  params: Record<string, unknown>,
): T | null {
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    console.warn(`[acp] ${method} schema mismatch:`, parsed.error.issues);
    return null;
  }
  return parsed.data;
}

export interface RoutedExtUpdate {
  update: AcpUpdate;
  sessionId: string;
  replayFor?: string;
}

export function routeExtNotification(
  method: string,
  params: Record<string, unknown>,
): RoutedExtUpdate | null {
  const replayFor = replayForOf(params._meta);
  switch (method) {
    case "platform/turnEnded": {
      const p = parseExtParams(method, platformTurnEndedParamsSchema, params);
      if (!p) return null;
      return {
        update: { sessionUpdate: "platform_turn_ended", ...p },
        sessionId: p.sessionId,
        replayFor,
      };
    }
    case "platform/promptAccepted": {
      const p = parseExtParams(
        method,
        platformPromptAcceptedParamsSchema,
        params,
      );
      if (!p) return null;
      return {
        update: { sessionUpdate: "platform_prompt_accepted", ...p },
        sessionId: p.sessionId,
        replayFor,
      };
    }
    case "platform/promptStarted": {
      const p = parseExtParams(
        method,
        platformPromptStartedParamsSchema,
        params,
      );
      if (!p) return null;
      return {
        update: { sessionUpdate: "platform_prompt_started", ...p },
        sessionId: p.sessionId,
        replayFor,
      };
    }
    default:
      return null;
  }
}
