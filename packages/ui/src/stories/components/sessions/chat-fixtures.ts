/**
 * Pieces of the checkout-service "one-cent rounding" transcript, projected by
 * the real ACP projection (`transcriptMessages`), for the chat component
 * stories. Every value here is read out of that fixture conversation.
 */
import { PROMPT_QUEUE_FULL_MESSAGE } from "api-server-api";

import type { Message, MessagePart, ToolChip } from "@/types";

import { appendUndelivered } from "../../../modules/acp/session-projection.js";
import { ago } from "../../backend/scenario";
import { transcriptMessages } from "../agents/story-helpers";

export const CHECKOUT_MESSAGES: Message[] = transcriptMessages();

function first<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`fixture transcript has no ${what}`);
  return value;
}

export const USER_MESSAGE = first(
  CHECKOUT_MESSAGES.find((m) => m.role === "user"),
  "user message",
);

export const AGENT_REPLY = first(
  CHECKOUT_MESSAGES.find((m) => m.role === "assistant"),
  "agent reply",
);

const allParts: MessagePart[] = CHECKOUT_MESSAGES.flatMap((m) => m.parts);

export const TOOL_CHIPS: ToolChip[] = allParts.filter(
  (p): p is ToolChip => p.kind === "tool",
);

export const COMPLETED_CHIP = first(
  TOOL_CHIPS.find((c) => c.status === "completed" && c.content?.length),
  "completed tool call with output",
);

export const FAILED_CHIP = first(
  TOOL_CHIPS.find((c) => c.status === "failed"),
  "failed tool call",
);

type TextLike = Extract<MessagePart, { kind: "text" | "thought" }>;
const isKind =
  (kind: TextLike["kind"]) =>
  (p: MessagePart): p is TextLike =>
    p.kind === kind;

export const THOUGHT_TEXT = first(
  allParts.find(isKind("thought")),
  "thought",
).text;

/** The agent's last prose part: the wrap-up with markdown and code. */
export const MARKDOWN_TEXT = first(
  CHECKOUT_MESSAGES.filter((m) => m.role === "assistant")
    .flatMap((m) => m.parts)
    .reverse()
    .find(isKind("text")),
  "agent text",
).text;

/** The last shell command the agent ran (`pnpm test && pnpm build`). */
export const EXECUTE_CHIP = first(
  [...TOOL_CHIPS].reverse().find((c) => c.title.includes("pnpm")),
  "shell tool call",
);

const userText = first(USER_MESSAGE.parts.find(isKind("text")), "user text").text;

/** The first prompt, recorded by the runtime as never delivered, as the real
 *  projection turns such a record into a bubble. */
export function undeliveredMessage(reason?: string): Message {
  return first(
    appendUndelivered(
      [],
      [
        {
          id: "undelivered-1",
          recordedAt: ago(2),
          blocks: [{ type: "text", text: userText }],
          droppedAttachments: [],
          ...(reason !== undefined && { reason }),
        },
      ],
    )[0],
    "undelivered bubble",
  );
}

export const QUEUE_FULL_REASON = PROMPT_QUEUE_FULL_MESSAGE;
