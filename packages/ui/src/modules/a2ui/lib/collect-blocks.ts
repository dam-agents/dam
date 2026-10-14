import type { Message } from "../../../types.js";
import type { BlockInput } from "./conversation.js";
import { hasA2uiBlock, splitA2uiBlocks } from "./split-blocks.js";

export function blockKey(partKey: string, blockIndex: number): string {
  return `${partKey}:${blockIndex}`;
}

export function partKey(messageId: string, partIndex: number): string {
  return `${messageId}:${partIndex}`;
}

export function collectBlocks(messages: readonly Message[]): BlockInput[] {
  return messages.flatMap((message) => {
    if (message.role !== "assistant" || message.notice) return [];
    return message.parts.flatMap((part, partIndex) => {
      if (part.kind !== "text" || !hasA2uiBlock(part.text)) return [];
      return splitA2uiBlocks(part.text)
        .flatMap((segment) => (segment.kind === "a2ui" ? [segment] : []))
        .map((segment, index) => ({
          key: blockKey(partKey(message.id, partIndex), index),
          messageId: message.id,
          source: segment.source,
          closed: segment.closed || !message.streaming,
        }));
    });
  });
}
