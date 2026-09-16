import { type RefObject, useEffect } from "react";

import { emitToast } from "../../../lib/toast.js";
import { readArtifactPrompt } from "../lib/artifact-prompt.js";

export function useArtifactPrompt(
  frame: RefObject<HTMLIFrameElement | null>,
  onSendPrompt: ((prompt: string) => Promise<void>) | undefined,
): void {
  useEffect(() => {
    if (!onSendPrompt) return;
    const receive = (event: MessageEvent) => {
      const prompt = readArtifactPrompt(event, frame.current?.contentWindow);
      if (prompt === null) return;
      void onSendPrompt(prompt).catch(() => {
        emitToast({
          kind: "error",
          message: "Couldn't send the artifact's prompt.",
        });
      });
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [frame, onSendPrompt]);
}
