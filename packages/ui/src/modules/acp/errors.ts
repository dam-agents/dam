import {
  AUTH_ERROR_HINT,
  jsonRpcErrorDetails,
  nextUtcMidnight,
  platformUndeliveredMetaSchema,
  type PlatformUndeliveredPrompt,
  PROMPT_NOT_QUEUED_CODE,
  PROMPT_NOT_QUEUED_MESSAGE,
  PROMPT_QUEUE_FULL_CODE,
  PROMPT_QUEUE_FULL_MESSAGE,
  saysProviderUnavailable,
} from "api-server-api";
import { z } from "zod";

import { localResetTime } from "../spend/lib/format.js";
import { connectionWentAway } from "./close-race.js";

export function describeJsonRpcError(
  message: string,
  details: string | undefined,
): string {
  if (!details || message.includes(details)) return message;
  return /^internal error\.?$/i.test(message.trim())
    ? details
    : `${message}: ${details}`;
}

export function extractErrorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message: unknown }).message;
    if (typeof m === "string" && m) {
      return describeJsonRpcError(
        m,
        jsonRpcErrorDetails((e as { data?: unknown }).data),
      );
    }
  }
  if (e instanceof Error) return e.message;
  if (typeof CloseEvent !== "undefined" && e instanceof CloseEvent) {
    return e.reason || `Connection closed (code ${e.code})`;
  }
  if (typeof Event !== "undefined" && e instanceof Event) {
    return "Connection error";
  }
  return String(e);
}

export const QUEUE_FULL_DESCRIPTION: SendErrorDescription = {
  message: "This conversation already has too many messages waiting.",
  hint: "The agent works through one message at a time. Wait for it to catch up, then send this again.",
};

export function isNotQueuedError(e: unknown): boolean {
  if (e && typeof e === "object") {
    const data = (e as { data?: { code?: unknown } }).data;
    if (data?.code === PROMPT_NOT_QUEUED_CODE) return true;
  }
  return extractErrorMessage(e).startsWith(PROMPT_NOT_QUEUED_MESSAGE);
}

export function isQueueFullError(e: unknown): boolean {
  if (e && typeof e === "object") {
    const data = (e as { data?: { code?: unknown } }).data;
    if (data?.code === PROMPT_QUEUE_FULL_CODE) return true;
  }
  return extractErrorMessage(e).startsWith(PROMPT_QUEUE_FULL_MESSAGE);
}

interface SendErrorDescription {
  title?: string;
  message: string;
  hint?: string;
  kind?: "provider-unavailable";
}

const SEND_ERROR_HINTS: ReadonlyArray<[RegExp, string]> = [
  [
    /\b402\b|payment[\s_-]?required|insufficient[\s_-]?credits|credit balance|quota exceeded|out of credits/i,
    "The model backend refused the request for billing reasons — the inference account is out of credits or over quota. Topping up or raising the quota on the provider account should restore sends.",
  ],
  [
    /\b401\b|authentication_error|unauthenticated|invalid (api|x-api)[\s_-]?key|unauthorized/i,
    AUTH_ERROR_HINT,
  ],
  [
    /\b429\b|rate[\s_-]?limit/i,
    "The model backend is rate-limiting requests. Wait a moment and retry.",
  ],
];

export type SpendRefusalViewer =
  | { role: "owner" }
  | { role: "editor"; owner: string; agentLimitReached: boolean };

const OWNER_VIEWER: SpendRefusalViewer = { role: "owner" };

export function isSpendRefusal(raw: string): boolean {
  return /spend quota exceeded/i.test(raw);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: What a chat says when a spend limit stops a
 * model call. Only the owner continues an Agent past a limit, on Home, so an
 * Agent Editor reads whom to ask instead. The refusal does not say which
 * limit stopped the call; the caller works out whether it was the Agent's
 * own limit, which an editor may also ask the owner to raise.
 */
function describeSpendRefusal(
  raw: string,
  viewer: SpendRefusalViewer,
): SendErrorDescription | null {
  if (!isSpendRefusal(raw)) return null;
  const reset = localResetTime(nextUtcMidnight());
  const hint = `Details: ${raw}`;
  if (/platform operator/i.test(raw))
    return {
      title: "Spend ceiling reached:",
      message:
        viewer.role === "owner"
          ? `You reached the daily spend ceiling that your operator set, so paid model calls stop. Ask your operator for a higher ceiling, or wait until ${reset} your time.`
          : `${viewer.owner} reached the daily spend ceiling that the operator set, so paid model calls stop. Wait until ${reset} your time.`,
      hint,
    };
  const stopped =
    "This agent reached a daily spend limit, so its model calls stop.";
  if (viewer.role === "owner")
    return {
      title: "Spend limit reached:",
      message: `${stopped} Continue it on Home, or wait until ${reset} your time.`,
      hint,
    };
  const ask = viewer.agentLimitReached
    ? `Ask ${viewer.owner} to continue or raise this agent's spend limit`
    : `Ask ${viewer.owner} to continue`;
  return {
    title: "Spend limit reached:",
    message: `${stopped} ${ask}, or wait until ${reset} your time.`,
    hint,
  };
}

export function describeSendError(
  raw: string,
  viewer: SpendRefusalViewer = OWNER_VIEWER,
): SendErrorDescription {
  if (
    raw === QUEUE_FULL_DESCRIPTION.message ||
    raw.startsWith(PROMPT_QUEUE_FULL_MESSAGE)
  )
    return QUEUE_FULL_DESCRIPTION;
  const spendRefusal = describeSpendRefusal(raw, viewer);
  if (spendRefusal) return spendRefusal;
  for (const [pattern, hint] of SEND_ERROR_HINTS) {
    if (!pattern.test(raw)) continue;
    if (raw.startsWith(AUTH_ERROR_HINT)) return { message: raw };
    return { message: raw, hint };
  }
  if (saysProviderUnavailable(raw))
    return { message: raw, kind: "provider-unavailable" };
  if (/process exited unexpectedly/i.test(raw)) {
    return {
      message: "The agent's process stopped unexpectedly.",
      hint: "Send a message to continue — the conversation is kept. This can happen when the agent runs low on memory.",
    };
  }
  if (/^internal error\.?$/i.test(raw.trim())) {
    return {
      message: "The agent couldn't process this message.",
      hint: "The harness reported an internal error without details — the agent's session log usually has the underlying cause (often the model backend rejecting the request).",
    };
  }
  return { message: raw };
}

type ResumeErrorKind = "not-found" | "connection" | "other";

export function classifyResumeError(e: unknown): ResumeErrorKind {
  if (e && typeof e === "object") {
    const anyE = e as { code?: unknown; data?: { code?: unknown } };
    if (anyE.code === -32002) return "not-found";
    if (anyE.data?.code === "NOT_FOUND") return "not-found";
    if (e instanceof DOMException || connectionWentAway(e)) return "connection";
  }
  const msg = extractErrorMessage(e);
  if (/not\s*found/i.test(msg)) return "not-found";
  if (/refused|ECONN|WebSocket|network/i.test(msg)) return "connection";
  return "other";
}

const unstoredDataSchema = z.object({
  platform: z.object({
    unstored: z.literal(true),
    undelivered: platformUndeliveredMetaSchema,
  }),
});

export function unstoredSessionPrompts(
  e: unknown,
): PlatformUndeliveredPrompt[] | null {
  const data = (e as { data?: unknown } | null)?.data;
  const parsed = unstoredDataSchema.safeParse(data);
  return parsed.success ? parsed.data.platform.undelivered : null;
}

export type SessionFailureKind =
  "unavailable" | "orphaned" | "connection" | "other";

export type SessionListing = "listed" | "absent" | "unknown";

export function resumeFailureKind(
  kind: ResumeErrorKind,
  listing: SessionListing,
): SessionFailureKind {
  if (listing === "absent") return "unavailable";
  if (kind !== "not-found") return kind;
  return listing === "listed" ? "orphaned" : "unavailable";
}
