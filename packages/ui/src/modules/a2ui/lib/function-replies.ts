import type {
  A2uiConversation,
  FunctionResponse,
} from "api-server-api/chat-forms";

import type { Message } from "../../../types.js";
import { parseUserText } from "./prompts.js";

export const MAX_AUTOMATIC_REPLIES = 3;

export function userText(message: Message): string {
  return message.parts
    .flatMap((part) => (part.kind === "text" ? [part.text] : []))
    .join("\n");
}

function rendererResponses(message: Message): string[] {
  return parseUserText(userText(message)).messages.flatMap((rendererMessage) =>
    "rendererFunctionResponse" in rendererMessage
      ? [rendererMessage.rendererFunctionResponse.functionCallId]
      : [],
  );
}

function isAutomaticReply(message: Message): boolean {
  const parsed = parseUserText(userText(message));
  return (
    parsed.text === "" &&
    parsed.messages.length > 0 &&
    parsed.messages.every((m) => "rendererFunctionResponse" in m)
  );
}

export function answeredCallIds(messages: readonly Message[]): Set<string> {
  return new Set(
    messages
      .filter((message) => message.role === "user")
      .flatMap(rendererResponses),
  );
}

export function trailingAutomaticReplies(messages: readonly Message[]): number {
  let count = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    if (!isAutomaticReply(message)) break;
    count += 1;
  }
  return count;
}

export function pendingResponses(
  conversation: A2uiConversation,
  liveMessageId: string | null,
  answered: ReadonlySet<string>,
): FunctionResponse[] {
  if (liveMessageId === null) return [];
  return [...conversation.blocks.values()]
    .filter((block) => block.messageId === liveMessageId)
    .flatMap((block) => block.functionCalls)
    .map((call) => call.response)
    .filter((response) => !answered.has(response.functionCallId));
}
