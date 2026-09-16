import {
  platformFrameMetaSchema,
  platformPromptAcceptedParamsSchema,
  platformPromptStartedParamsSchema,
  platformRunStartedParamsSchema,
  platformTurnEndedParamsSchema,
  platformTurnTelemetryParamsSchema,
} from "api-server-api";
import type { z } from "zod";

import type { AcpUpdate, FrameMeta } from "./types.js";

export function frameMetaOf(meta: unknown): FrameMeta {
  if (typeof meta !== "object" || meta === null) return {};
  const platform = (meta as Record<string, unknown>).platform;
  if (typeof platform !== "object" || platform === null) return {};
  const { replayFor, at, telemetryPromptId } = platform as Record<
    string,
    unknown
  >;
  const parsedAt = platformFrameMetaSchema.shape.at.safeParse(at);
  return {
    ...(typeof replayFor === "string" ? { replayFor } : {}),
    ...(parsedAt.success && parsedAt.data !== undefined
      ? { at: parsedAt.data }
      : {}),
    ...(typeof telemetryPromptId === "string" && telemetryPromptId !== ""
      ? { telemetryPromptId }
      : {}),
  };
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
  frame: FrameMeta;
}

export function routeExtNotification(
  method: string,
  params: Record<string, unknown>,
): RoutedExtUpdate | null {
  const frame = frameMetaOf(params._meta);
  switch (method) {
    case "platform/turnEnded": {
      const p = parseExtParams(method, platformTurnEndedParamsSchema, params);
      if (!p) return null;
      return {
        update: { sessionUpdate: "platform_turn_ended", ...p },
        sessionId: p.sessionId,
        frame,
      };
    }
    case "platform/turnTelemetry": {
      const p = parseExtParams(
        method,
        platformTurnTelemetryParamsSchema,
        params,
      );
      if (!p) return null;
      return {
        update: { sessionUpdate: "platform_turn_telemetry", ...p },
        sessionId: p.sessionId,
        frame,
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
        frame,
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
        frame,
      };
    }
    case "platform/runStarted": {
      const p = parseExtParams(method, platformRunStartedParamsSchema, params);
      if (!p) return null;
      return {
        update: { sessionUpdate: "platform_run_started", ...p },
        sessionId: p.sessionId,
        frame,
      };
    }
    default:
      return null;
  }
}
