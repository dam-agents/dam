import { isNonNullObject, sessionUpdateOf } from "api-server-api";

export interface LocalCommandEchoes {
  start(sessionId: string, typed: unknown): void;
  isEcho(sessionId: string, frame: unknown): boolean;
  end(sessionId: string): void;
  clear(): void;
}

const WORK_UPDATES = new Set([
  "agent_thought_chunk",
  "tool_call",
  "tool_call_update",
]);

interface Message {
  messageId: string | null;
  text: string;
}

function slashCommandOf(typed: unknown): boolean {
  if (!Array.isArray(typed) || typed.length !== 1) return false;
  const [block] = typed as unknown[];
  return (
    isNonNullObject(block) &&
    block.type === "text" &&
    typeof block.text === "string" &&
    block.text.trimStart().startsWith("/")
  );
}

function agentTextOf(update: Record<string, unknown>): Message | null {
  if (update.sessionUpdate !== "agent_message_chunk") return null;
  const content = update.content;
  if (
    !isNonNullObject(content) ||
    content.type !== "text" ||
    typeof content.text !== "string"
  )
    return null;
  return {
    messageId: typeof update.messageId === "string" ? update.messageId : null,
    text: content.text,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Finds the second copy of a local command's output
 * in a prompt turn. Claude Code answers a command like `/context` without a
 * model call, and its adapter sends that output twice: once from the CLI's
 * synthetic reply, and once more from the turn's result text, as a new agent
 * message. The runtime drops the copy before the Session Transcript, so the
 * Session shows the output once, live and after a reload. Only a turn whose
 * prompt is one text block that starts with `/` is watched, and a copy is an
 * agent message whose whole text, without trailing white space, is the whole
 * text of the message just before it, with no thought or tool call between
 * them: a command that runs the model, such as a skill, keeps what it says.
 */
export function createLocalCommandEchoes(): LocalCommandEchoes {
  const watched = new Map<string, Message | null>();

  return {
    start(sessionId, typed) {
      if (slashCommandOf(typed)) watched.set(sessionId, null);
      else watched.delete(sessionId);
    },

    isEcho(sessionId, frame) {
      if (!watched.has(sessionId)) return false;
      const update = sessionUpdateOf(frame);
      if (update === null) return false;
      if (WORK_UPDATES.has(String(update.sessionUpdate))) {
        watched.set(sessionId, null);
        return false;
      }
      const chunk = agentTextOf(update);
      if (chunk === null) return false;
      const last = watched.get(sessionId) ?? null;
      if (last !== null && last.messageId === chunk.messageId) {
        last.text += chunk.text;
        return false;
      }
      if (last !== null && last.text.trimEnd() === chunk.text.trimEnd())
        return true;
      watched.set(sessionId, { ...chunk });
      return false;
    },

    end(sessionId) {
      watched.delete(sessionId);
    },

    clear() {
      watched.clear();
    },
  };
}
