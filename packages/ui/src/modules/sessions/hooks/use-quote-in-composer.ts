import { type RefObject, useCallback } from "react";

import { useStore } from "../../../store.js";
import { draftKey } from "../lib/draft-key.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Leaves text from a docked surface in the open
 * chat's draft and puts the caret after it, so the user writes their reply
 * there and decides whether to send. A terminal Session has no composer, so it
 * offers nothing.
 */
export function useQuoteInComposer({
  agentId,
  sessionId,
  composerShown,
  textareaRef,
}: {
  agentId: string | null;
  sessionId: string | null;
  composerShown: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}): ((text: string) => void) | undefined {
  const appendDraft = useStore((s) => s.appendDraft);
  const setMobileScreen = useStore((s) => s.setMobileScreen);
  const quote = useCallback(
    (text: string) => {
      if (!agentId) return;
      appendDraft(draftKey(agentId, sessionId), text);
      setMobileScreen("chat");
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(
          textarea.value.length,
          textarea.value.length,
        );
      });
    },
    [agentId, sessionId, appendDraft, setMobileScreen, textareaRef],
  );
  return agentId && composerShown ? quote : undefined;
}
