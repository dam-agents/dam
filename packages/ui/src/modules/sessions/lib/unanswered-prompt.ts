import { REWRITE_BUSY_CODE, REWRITE_REFUSED_CODE } from "api-server-api";
import { z } from "zod";

import type { Message } from "../../../types.js";

export function messageText(message: Message): string {
  return message.parts
    .flatMap((p) => (p.kind === "text" ? [p.text] : []))
    .join("\n\n");
}

export function unansweredPrompt(messages: readonly Message[]): Message | null {
  const n = messages.length;
  const reply = n > 0 ? messages[n - 1] : undefined;
  const prompt = n > 1 ? messages[n - 2] : undefined;
  if (
    reply?.role !== "assistant" ||
    !reply.streaming ||
    reply.queued ||
    reply.parts.length > 0
  )
    return null;
  if (
    prompt?.role !== "user" ||
    prompt.queued ||
    prompt.error !== undefined ||
    prompt.parts.some((p) => p.kind !== "text")
  )
    return null;
  if (n > 2 && messages[n - 3].role === "user") return null;
  return prompt;
}

function hasErrorCode(err: unknown, code: string): boolean {
  return z.object({ data: z.object({ code: z.literal(code) }) }).safeParse(err)
    .success;
}

export function isRewriteBusy(err: unknown): boolean {
  return hasErrorCode(err, REWRITE_BUSY_CODE);
}

export function isRewriteRefused(err: unknown): boolean {
  return hasErrorCode(err, REWRITE_REFUSED_CODE);
}
