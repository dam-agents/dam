import {
  chatFormAnnouncementOf,
  chatFormFixPrompt,
  checkChatForm,
  hasA2uiBlock,
  type ChatFormAnnouncement,
} from "api-server-api/chat-forms";

const REPLY_TEXT_CAP = 1024 * 1024;

export interface ChatFormFix {
  attempt: number;
  prompt: string;
}

export interface ChatFormTurnEnd {
  stopReason: string | null;
  failed: boolean;
  nextPromptWaiting: boolean;
}

export interface ChatFormChecks {
  start(sessionId: string, prompt: unknown): void;
  text(sessionId: string, text: string): void;
  end(sessionId: string, end: ChatFormTurnEnd): ChatFormFix | null;
  forget(sessionId: string): void;
  clear(): void;
}

function promptText(prompt: unknown): string {
  if (!Array.isArray(prompt)) return "";
  return prompt
    .flatMap((block: unknown) => {
      const { type, text } = (block ?? {}) as {
        type?: unknown;
        text?: unknown;
      };
      return type === "text" && typeof text === "string" ? [text] : [];
    })
    .join("\n\n");
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: checks the chat forms in the reply to every
 * prompt turn whose prompt announced the renderer capabilities, with the same
 * check the chat replays a form with, so a broken form goes back to the agent
 * instead of to the user. A turn the user stopped, one that failed, and one
 * with a prompt already waiting behind it are left alone: the user has moved
 * on. The fix prompt counts its attempt in its own text, and after
 * MAX_CHAT_FORM_FIXES fixes the last one asks for plain text and announces no
 * capabilities, so the reply to it is never checked and the loop ends.
 */
export function createChatFormChecks(): ChatFormChecks {
  const turns = new Map<
    string,
    { announcement: ChatFormAnnouncement; reply: string; cut: boolean }
  >();

  return {
    start(sessionId, prompt) {
      const announcement = chatFormAnnouncementOf(promptText(prompt));
      if (announcement === null) turns.delete(sessionId);
      else turns.set(sessionId, { announcement, reply: "", cut: false });
    },

    text(sessionId, text) {
      const turn = turns.get(sessionId);
      if (turn === undefined || turn.cut) return;
      if (turn.reply.length + text.length > REPLY_TEXT_CAP) turn.cut = true;
      else turn.reply += text;
    },

    end(sessionId, end) {
      const turn = turns.get(sessionId);
      turns.delete(sessionId);
      if (turn === undefined || turn.cut) return null;
      if (end.failed || end.nextPromptWaiting) return null;
      if (end.stopReason !== "end_turn") return null;
      if (!hasA2uiBlock(turn.reply)) return null;
      const { preferences, fixAttempt } = turn.announcement;
      const check = checkChatForm(turn.reply, preferences);
      if (check.ok) return null;
      const attempt = fixAttempt + 1;
      return {
        attempt,
        prompt: chatFormFixPrompt(check, attempt, preferences),
      };
    },

    forget(sessionId) {
      turns.delete(sessionId);
    },

    clear() {
      turns.clear();
    },
  };
}
