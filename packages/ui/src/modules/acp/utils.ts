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
  agentId: string,
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
          agentId,
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

// Error extraction/presentation helpers live in ./errors.js — kept separate
// so node-environment unit tests can import them without this module's
// upload-API dependency chain (which touches `window` at import time).
