import {
  PROMPT_QUEUE_FULL_CODE,
  PROMPT_QUEUE_FULL_MESSAGE,
} from "api-server-api";

export function extractErrorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message: unknown }).message;
    if (typeof m === "string" && m) {
      const details = jsonRpcErrorDetails(e);
      if (details && !m.includes(details)) {
        return /^internal error\.?$/i.test(m.trim())
          ? details
          : `${m}: ${details}`;
      }
      return m;
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

function jsonRpcErrorDetails(e: object): string | null {
  const data = (e as { data?: unknown }).data;
  if (typeof data === "string" && data) return data;
  if (data && typeof data === "object") {
    const details = (data as { details?: unknown }).details;
    if (typeof details === "string" && details) return details;
  }
  return null;
}

export const QUEUE_FULL_DESCRIPTION: SendErrorDescription = {
  message: "This conversation already has too many messages waiting.",
  hint: "The agent works through one message at a time. Wait for it to catch up, then send this again.",
};

export function isQueueFullError(e: unknown): boolean {
  if (e && typeof e === "object") {
    const data = (e as { data?: { code?: unknown } }).data;
    if (data?.code === PROMPT_QUEUE_FULL_CODE) return true;
  }
  return extractErrorMessage(e).startsWith(PROMPT_QUEUE_FULL_MESSAGE);
}

export interface SendErrorDescription {
  message: string;
  hint?: string;
}

const SEND_ERROR_HINTS: ReadonlyArray<[RegExp, string]> = [
  [
    /\b402\b|payment[\s_-]?required|insufficient[\s_-]?credits|credit balance|quota exceeded|out of credits/i,
    "The model backend refused the request for billing reasons — the inference account is out of credits or over quota. Topping up or raising the quota on the provider account should restore sends.",
  ],
  [
    /\b401\b|authentication_error|unauthenticated|invalid (api|x-api)[\s_-]?key|unauthorized/i,
    "The model backend rejected the credential. Check that the API/OAuth secret is correct and linked to this agent (Agents → select agent → Secrets).",
  ],
  [
    /\b429\b|rate[\s_-]?limit/i,
    "The model backend is rate-limiting requests. Wait a moment and retry.",
  ],
];

export function describeSendError(raw: string): SendErrorDescription {
  if (
    raw === QUEUE_FULL_DESCRIPTION.message ||
    raw.startsWith(PROMPT_QUEUE_FULL_MESSAGE)
  )
    return QUEUE_FULL_DESCRIPTION;
  for (const [pattern, hint] of SEND_ERROR_HINTS) {
    if (!pattern.test(raw)) continue;
    if (/credential secret/i.test(raw)) return { message: raw };
    return { message: raw, hint };
  }
  if (/^internal error\.?$/i.test(raw.trim())) {
    return {
      message: "The agent couldn't process this message.",
      hint: "The harness reported an internal error without details — the agent's session log usually has the underlying cause (often the model backend rejecting the request).",
    };
  }
  return { message: raw };
}

export type ResumeErrorKind = "not-found" | "connection" | "other";

export function classifyResumeError(e: unknown): ResumeErrorKind {
  if (e && typeof e === "object") {
    const anyE = e as { code?: unknown; data?: { code?: unknown } };
    if (anyE.code === -32002) return "not-found";
    if (anyE.data?.code === "NOT_FOUND") return "not-found";
    if (e instanceof DOMException) return "connection";
  }
  const msg = extractErrorMessage(e);
  if (/not\s*found/i.test(msg)) return "not-found";
  if (/refused|ECONN|WebSocket|network/i.test(msg)) return "connection";
  return "other";
}

export type SessionFailureKind =
  | "unavailable"
  | "orphaned"
  | "connection"
  | "other";

export type SessionListing = "listed" | "absent" | "unknown";

export function resumeFailureKind(
  kind: ResumeErrorKind,
  listing: SessionListing,
): SessionFailureKind {
  if (listing === "absent") return "unavailable";
  if (kind !== "not-found") return kind;
  return listing === "listed" ? "orphaned" : "unavailable";
}
