import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useRef } from "react";

import { useStore } from "../../../store.js";
import type { Message } from "../../../types.js";

function promptText(message: Message): string {
  return message.parts
    .flatMap((p) => (p.kind === "text" ? [p.text] : []))
    .join("\n\n")
    .trim();
}

function promptsNewestFirst(messages: Message[]): string[] {
  const prompts: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "user") continue;
    const text = promptText(m);
    if (text && text !== prompts[prompts.length - 1]) prompts.push(text);
  }
  return prompts;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Walks the session's own prompts in the composer
 * with the arrow keys, as a terminal walks its history. The keys act only with
 * the caret at the very start, so they still move the caret everywhere else;
 * a recalled prompt puts it back there. Up steps back, Down steps forward, and
 * stepping past the newest prompt restores the draft the walk started from.
 * Typing ends the walk, so what the person edits becomes the draft.
 */
export function usePromptHistory(apply: (text: string) => void): {
  navigate: (e: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  reset: () => void;
} {
  const messages = useStore((s) => s.messages);
  const history = useMemo(() => promptsNewestFirst(messages), [messages]);
  const sessionId = useStore((s) => s.sessionId);
  const walk = useRef<{ index: number; draft: string } | null>(null);
  useEffect(() => {
    walk.current = null;
  }, [sessionId]);

  const navigate = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return false;
    const { value, selectionStart, selectionEnd } = e.currentTarget;
    if (selectionStart !== 0 || selectionEnd !== 0) return false;

    if (e.key === "ArrowUp") {
      const index = (walk.current?.index ?? -1) + 1;
      if (index >= history.length) return false;
      walk.current = { index, draft: walk.current?.draft ?? value };
      apply(history[index]!);
      return true;
    }

    if (e.key === "ArrowDown") {
      const current = walk.current;
      if (current === null) return false;
      if (current.index === 0) {
        walk.current = null;
        apply(current.draft);
      } else {
        walk.current = { ...current, index: current.index - 1 };
        apply(history[current.index - 1]!);
      }
      return true;
    }

    return false;
  };

  return {
    navigate,
    reset: () => {
      walk.current = null;
    },
  };
}
