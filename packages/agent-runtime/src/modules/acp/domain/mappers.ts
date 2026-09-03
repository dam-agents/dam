import { randomUUID } from "node:crypto";
import {
  promptBlockSchema,
  UNDELIVERED_INLINE_IMAGE_BYTES_CAP,
  type PlatformUndeliveredPrompt,
  type PromptBlock,
} from "api-server-api";
import { z } from "zod";

export function undeliveredOf(
  promptId: string | null,
  frame: unknown,
  recordedAt: string,
): PlatformUndeliveredPrompt {
  const id = promptId ?? randomUUID();
  const raw = (frame as { params?: { prompt?: unknown } } | null)?.params
    ?.prompt;
  const parsed = z.array(promptBlockSchema).safeParse(raw);
  if (!parsed.success)
    return { id, recordedAt, blocks: [], droppedAttachments: [] };

  const blocks: PromptBlock[] = [];
  const droppedAttachments: string[] = [];
  let inlineBytes = 0;
  let images = 0;
  for (const block of parsed.data) {
    if (block.type !== "image") {
      blocks.push(block);
      continue;
    }
    images += 1;
    const name = `pasted image ${String(images)}`;
    if (inlineBytes + block.data.length > UNDELIVERED_INLINE_IMAGE_BYTES_CAP) {
      droppedAttachments.push(name);
      continue;
    }
    inlineBytes += block.data.length;
    blocks.push(block);
  }
  return { id, recordedAt, blocks, droppedAttachments };
}

const AUTH_HINT =
  "Authentication Error: Ensure the API/OAuth credential secret is correct and linked to this agent (Agents > select agent > Secrets).\n\nError: ";

export function rewriteAuthError(line: string): string {
  if (!line.includes("authentication_error")) return line;
  try {
    const msg = JSON.parse(line);
    if (msg?.error?.message?.includes?.("authentication_error")) {
      msg.error.message = AUTH_HINT + msg.error.message;
      return JSON.stringify(msg);
    }
    const text = msg?.params?.update?.content?.text;
    if (typeof text === "string" && text.includes("authentication_error")) {
      msg.params.update.content.text = AUTH_HINT + text;
      return JSON.stringify(msg);
    }
  } catch {}
  return line;
}

export function rewriteCwd<T>(frame: T, workingDir: string): T {
  if (typeof frame !== "object" || frame === null) return frame;
  const params = (frame as { params?: unknown }).params;
  if (typeof params !== "object" || params === null) return frame;
  const p = params as Record<string, unknown>;
  if (p.cwd === undefined) return frame;
  return { ...(frame as object), params: { ...p, cwd: workingDir } } as T;
}
