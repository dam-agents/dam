import { hasA2uiBlock, splitA2uiBlocks } from "api-server-api/chat-forms";

import type { Message } from "../../../types.js";
import { withoutAgentMarkup } from "../../acp/agent-markup.js";
import { blockKey, partKey } from "./collect-blocks.js";

export type SentBack = "fixing" | "replaced";

function answered(messages: readonly Message[], index: number): boolean {
  return messages
    .slice(index + 1)
    .some((m) => m.role === "assistant" && !m.notice && m.parts.length > 0);
}

// UNIT_BOUNDARY_DESCRIPTION: names the blocks of every reply whose turn the platform ended by sending its chat form back to the agent, so the chat shows that the agent is fixing the form instead of the broken form, until a later reply answers in its place.
export function sentBackBlocks(
  messages: readonly Message[],
): ReadonlyMap<string, SentBack> {
  const blocks = new Map<string, SentBack>();
  messages.forEach((message, index) => {
    if (message.role !== "assistant" || message.chatFormFix === undefined)
      return;
    const state = answered(messages, index) ? "replaced" : "fixing";
    withoutAgentMarkup(message.parts).forEach((part, partIndex) => {
      if (part.kind !== "text" || !hasA2uiBlock(part.text)) return;
      splitA2uiBlocks(part.text)
        .filter((segment) => segment.kind === "a2ui")
        .forEach((_, blockIndex) =>
          blocks.set(
            blockKey(partKey(message.id, partIndex), blockIndex),
            state,
          ),
        );
    });
  });
  return blocks;
}
