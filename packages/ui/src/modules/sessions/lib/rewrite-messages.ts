import type { Message, MessagePart } from "../../../types.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The thread right after a rewind or fork is sent:
 * everything above the rewritten message, then the new prompt and its reply
 * placeholder. The prompt is marked sent here, so the runtime's echo of it
 * replaces its parts instead of adding a second copy of the text.
 */
export function rewrittenThread(
  prev: readonly Message[],
  at: number,
  promptId: string,
  parts: MessagePart[],
): Message[] {
  return [
    ...prev.slice(0, at),
    {
      id: promptId,
      role: "user",
      parts,
      streaming: false,
      at: new Date().toISOString(),
      sentHere: true,
    },
    {
      id: crypto.randomUUID(),
      role: "assistant",
      parts: [],
      streaming: true,
      promptId,
    },
  ];
}
