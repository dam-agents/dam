import { getErrorMessage } from "@/lib/errors";

import type { Attachment } from "../../types.js";
import { uploadMessageAttachment } from "../files/api/queries.js";

export const RECONNECT_DELAYS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000];

export type PromptBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "resource_link"; uri: string; name: string; mimeType: string };

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
          `Upload failed for "${a.name}": ${getErrorMessage(err, "unknown")}`,
        );
      }
    }
  }
  if (text) blocks.push({ type: "text", text });
  return blocks;
}
