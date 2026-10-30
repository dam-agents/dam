import { type RefObject, useEffect } from "react";

import { emitToast } from "../../../lib/toast.js";
import { readArtifactPrompt } from "../lib/artifact-prompt.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: hands a frame's prompt to the chat it is docked
 * in. With no chat, only a prompt that asks for a session of its own goes
 * anywhere: to `onNewSessionPrompt`, when the preview may start one.
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
        onSendPrompt ?? (read.newSession ? onNewSessionPrompt : undefined);
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
