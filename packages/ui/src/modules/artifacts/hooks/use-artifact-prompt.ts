import { type RefObject, useEffect } from "react";

import { emitToast } from "../../../lib/toast.js";
import { readArtifactPrompt } from "../lib/artifact-prompt.js";

export const NO_CHAT_PROMPT_REFUSAL =
  "Open this artifact in its agent's chat to use this button.";

export const NO_SESSION_PROMPT_REFUSAL =
  "This button needs a session of its own, which this page cannot start here.";

export type ArtifactSessionPrompt = (
  prompt: string,
  conversation?: string,
) => Promise<void>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: hands a frame's prompt to the chat it is docked
 * in. A prompt that names a conversation goes to the owner's own Session for
 * that conversation instead, through `onNewSessionPrompt`, even beside the
 * chat, so a page used for many conversations keeps them apart. With no
 * chat, only a prompt that asks for a session of its own goes anywhere. A
 * prompt that cannot go anywhere is refused out loud, as a chat refuses one
 * it cannot take.
 */
export function useArtifactPrompt(
  frame: RefObject<HTMLIFrameElement | null>,
  onSendPrompt: ((prompt: string) => Promise<void>) | undefined,
  onNewSessionPrompt?: ArtifactSessionPrompt,
): void {
  useEffect(() => {
    if (!onSendPrompt && !onNewSessionPrompt) return;
    const refuse = (message: string) => () =>
      Promise.reject(new Error(message));
    const receive = (event: MessageEvent) => {
      const read = readArtifactPrompt(event, frame.current?.contentWindow);
      if (read === null) return;
      const { prompt, newSession, conversation } = read;
      const send =
        conversation !== undefined
          ? onNewSessionPrompt
            ? () => onNewSessionPrompt(prompt, conversation)
            : refuse(NO_SESSION_PROMPT_REFUSAL)
          : onSendPrompt
            ? () => onSendPrompt(prompt)
            : newSession && onNewSessionPrompt
              ? () => onNewSessionPrompt(prompt)
              : refuse(NO_CHAT_PROMPT_REFUSAL);
      void send().catch((error: unknown) => {
        emitToast({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "Couldn't send the artifact's prompt.",
        });
      });
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [frame, onSendPrompt, onNewSessionPrompt]);
}
