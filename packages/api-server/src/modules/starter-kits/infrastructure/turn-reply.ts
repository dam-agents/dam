import { sessionHistorySchema } from "agent-runtime-api";
import { isNonNullObject, parseFrame } from "api-server-api";

import { agentServiceClient } from "../../../core/agent-service-client.js";

const REPLY_TAIL_FRAMES = 2_000;

function textChunk(line: string, kind: string): string | null {
  const frame = parseFrame(line);
  if (!isNonNullObject(frame) || frame.method !== "session/update") return null;
  const update = isNonNullObject(frame.params) ? frame.params.update : null;
  if (!isNonNullObject(update) || update.sessionUpdate !== kind) return null;
  const content = update.content;
  return isNonNullObject(content) && typeof content.text === "string"
    ? content.text
    : "";
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the text the agent replied with since the last
 * prompt of the Session, read from the newest transcript frames. Frames
 * before that prompt belong to earlier turns and are not part of the reply.
 */
export function lastTurnReply(frames: readonly string[]): string {
  const chunks: string[] = [];
  for (let i = frames.length - 1; i >= 0; i--) {
    const line = frames[i]!;
    if (textChunk(line, "user_message_chunk") !== null) break;
    const text = textChunk(line, "agent_message_chunk");
    if (text) chunks.push(text);
  }
  return chunks.reverse().join("");
}

export function createTurnReplyReader(namespace: string) {
  return async (
    agentId: string,
    sessionId: string,
    signal: AbortSignal,
  ): Promise<string> => {
    const { frames } = sessionHistorySchema.parse(
      await agentServiceClient(agentId, namespace).sessions.history.query(
        { sessionId, tail: REPLY_TAIL_FRAMES },
        { signal },
      ),
    );
    return lastTurnReply(frames);
  };
}
