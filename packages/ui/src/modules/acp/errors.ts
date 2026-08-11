import {
  PROMPT_QUEUE_FULL_CODE,
  PROMPT_QUEUE_FULL_MESSAGE,
} from "api-server-api";

/**
 * Error extraction and presentation for the ACP session surface. Kept free of
 * imports with browser side effects so node-environment unit tests (and any
 * non-DOM caller) can use it directly.
 */

/**
 * Read a human-readable message off any error shape we may see here. The
 * promise that `prompt`/`loadSession` returns can reject with:
 *  - an `Error` / `DOMException` — has `.message`
 *  - the raw JSON-RPC error `{ code, message, data }` — has `.message`
 *  - a WebSocket `CloseEvent` on connection drop — no message; use `code`/`reason`
 *  - a WebSocket `Event` from `onerror` — browsers omit useful details here
 *
 * The fallback `String(e)` on an Event yields `[object Event]`, which is what
 * users were seeing on disconnect.
 */
export function extractErrorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message: unknown }).message;
    if (typeof m === "string" && m) {
      const details = jsonRpcErrorDetails(e);
      if (details && !m.includes(details)) {
        // "Internal error" is the JSON-RPC boilerplate for -32603 — the real
        // reason (e.g. the model backend's HTTP error) rides in data.details.
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

/** Pull the harness's detail string out of a JSON-RPC error's `data` slot.
 *  The ACP SDK ships it either as `data.details` (string) or as the whole
 *  `data` value when the harness threw a plain string. */
function jsonRpcErrorDetails(e: object): string | null {
  const data = (e as { data?: unknown }).data;
  if (typeof data === "string" && data) return data;
  if (data && typeof data === "object") {
    const details = (data as { details?: unknown }).details;
    if (typeof details === "string" && details) return details;
  }
  return null;
}

/** The runtime's queue-full rejection, in words that say what to do. */
export const QUEUE_FULL_DESCRIPTION: SendErrorDescription = {
  message: "This conversation already has too many messages waiting.",
  hint: "The agent works through one message at a time. Wait for it to catch up, then send this again.",
};

/** Whether the runtime refused the prompt because the session's queue is full.
 *  The structured cause is version-stable; the shared message stem covers a
 *  runtime older than that field. */
export function isQueueFullError(e: unknown): boolean {
  if (e && typeof e === "object") {
    const data = (e as { data?: { code?: unknown } }).data;
    if (data?.code === PROMPT_QUEUE_FULL_CODE) return true;
  }
  return extractErrorMessage(e).includes(PROMPT_QUEUE_FULL_MESSAGE);
}

export interface SendErrorDescription {
  /** What to render as the failure reason. */
  message: string;
  /** Actionable next step for failure classes we recognize. */
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

/**
 * Turn a raw send-failure message into what the error card renders. Known
 * upstream failure classes (billing, credentials, rate limits) get an
 * actionable hint; bare JSON-RPC "Internal error" — all the harness gave us —
 * gets replaced with wording that at least says where to look next.
 */
export function describeSendError(raw: string): SendErrorDescription {
  if (
    raw === QUEUE_FULL_DESCRIPTION.message ||
    raw.includes(PROMPT_QUEUE_FULL_MESSAGE)
  )
    return QUEUE_FULL_DESCRIPTION;
  for (const [pattern, hint] of SEND_ERROR_HINTS) {
    if (!pattern.test(raw)) continue;
    // agent-runtime already prefixes authentication_error frames with its own
    // remediation text (rewriteAuthError's AUTH_HINT) — when the message
    // already tells the user to check the credential secret, don't render a
    // second near-identical instruction underneath.
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

/** Whether the agent says it has no such session: ACP's own `-32002`, or the
 *  api-server's `NOT_FOUND`. Structured only — the wording changes, the codes
 *  do not. A send hits this as readily as a resume does. */
export function isMissingSessionError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const anyE = e as { code?: unknown; data?: { code?: unknown } };
  return anyE.code === -32002 || anyE.data?.code === "NOT_FOUND";
}

/**
 * Classify a resume-time failure so the inline error card can render the
 * right message and action. Prefers structured error fields (ACP JSON-RPC
 * `code`, tRPC `data.code`) over regexing the human-readable message — the
 * latter breaks the moment server wording changes.
 */
export function classifyResumeError(e: unknown): ResumeErrorKind {
  if (isMissingSessionError(e)) return "not-found";
  if (e instanceof DOMException) return "connection";
  const msg = extractErrorMessage(e);
  if (/not\s*found/i.test(msg)) return "not-found";
  if (/refused|ECONN|WebSocket|network/i.test(msg)) return "connection";
  return "other";
}

/** What the session error card renders. `orphaned` is the only kind carrying a
 *  row the user can act on; `unavailable` names a session the agent doesn't
 *  advertise at all — deleted, never there, or not theirs to open. */
export type SessionFailureKind =
  | "unavailable"
  | "orphaned"
  | "connection"
  | "other";

/** Whether the agent's session list claims the session, when it can be read. */
export type SessionListing = "listed" | "absent" | "unknown";

/**
 * The verdict on a resume failure, with the agent's own session list — not the
 * harness's error prose — deciding whether a session exists. Deleting is
 * offered on one condition: the list still advertises a session that won't
 * reopen, so there is a stale row to clear. A session the list doesn't have,
 * and one it couldn't be asked about, both leave nothing to delete.
 */
export function resumeFailureKind(
  kind: ResumeErrorKind,
  listing: SessionListing,
): SessionFailureKind {
  if (listing === "absent") return "unavailable";
  if (kind !== "not-found") return kind;
  return listing === "listed" ? "orphaned" : "unavailable";
}
