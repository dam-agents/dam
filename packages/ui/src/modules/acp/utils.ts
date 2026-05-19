import type { Attachment } from "../../types.js";
import { uploadMessageAttachment } from "../files/api/queries.js";

/** Backoff schedule for the keep-alive reconnect loop. Capped at 30s. */
export const RECONNECT_DELAYS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000];

export type PromptBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "resource_link"; uri: string; name: string; mimeType: string };

/** Turn composer state into an ACP prompt-blocks array. Images ride inline
 *  so Claude's vision can see the bytes; every other attachment is persisted
 *  on the agent pod first and referenced by absolute `file://` URI — the old
 *  behaviour (inline text resources and bogus `file:///name` URIs) left the
 *  agent with references to files it couldn't actually read. */
export async function buildPromptBlocks(
  instanceId: string,
  sessionId: string,
  text: string,
  attachments: Attachment[] | undefined,
): Promise<PromptBlock[]> {
  const blocks: PromptBlock[] = [];
  if (attachments?.length) {
    for (const a of attachments) {
      if (a.kind === "image") {
        blocks.push({ type: "image", data: a.data, mimeType: a.mimeType });
        continue;
      }
      try {
        const { absolutePath } = await uploadMessageAttachment(
          instanceId,
          sessionId,
          {
            name: a.name,
            data: a.data,
            mimeType: a.mimeType,
          },
        );
        blocks.push({
          type: "resource_link",
          uri: `file://${absolutePath}`,
          name: a.name,
          mimeType: a.mimeType,
        });
      } catch (err) {
        throw new Error(
          `Upload failed for "${a.name}": ${err instanceof Error ? err.message : "unknown"}`,
        );
      }
    }
  }
  if (text) blocks.push({ type: "text", text });
  return blocks;
}

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
    if (typeof m === "string" && m) return m;
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

/**
 * Classify a resume-time failure so the inline error card can render the
 * right message and action. Prefers structured error fields (ACP JSON-RPC
 * `code`, tRPC `data.code`) over regexing the human-readable message — the
 * latter breaks the moment server wording changes.
 */
export function classifyResumeError(
  e: unknown,
): "not-found" | "connection" | "other" {
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
