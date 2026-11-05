import { type RefObject, useEffect } from "react";

import { emitToast } from "../../../lib/toast.js";
import { readArtifactPrompt } from "../lib/artifact-prompt.js";

export const NO_CHAT_PROMPT_REFUSAL =
  "Open this artifact in its agent's chat to use this button.";

/**
 * UNIT_BOUNDARY_DESCRIPTION: hands a frame's prompt to the chat it is docked
 * in. With no chat, only a prompt that asks for a session of its own goes
 * anywhere: to `onNewSessionPrompt`, when the preview may start one. A plain
 * prompt there is refused out loud, as a chat refuses one it cannot take.
 */
export function useArtifactPrompt(
  frame: RefObject<HTMLIFrameElement | null>,
  onSendPrompt: ((prompt: string) => Promise<void>) | undefined,
  onNewSessionPrompt?: (prompt: string) => Promise<void>,
): void {
  useEffect(() => {
    if (!onSendPrompt && !onNewSessionPrompt) return;
    const receive = (event: MessageEvent) => {
      const read = readArtifactPrompt(event, frame.current?.contentWindow);
      if (read === null) return;
      const send =
        onSendPrompt ??
        (read.newSession
          ? onNewSessionPrompt
          : () => Promise.reject(new Error(NO_CHAT_PROMPT_REFUSAL)));
      if (!send) return;
      void send(read.prompt).catch((error: unknown) => {
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
