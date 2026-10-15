import { useState } from "react";

import { Button } from "@/components/ui/button";

import { emitToast } from "../../../lib/toast.js";
import { useA2uiSendPrompt } from "../contexts/a2ui-action-context.js";
import { useA2uiConversationState } from "../contexts/a2ui-conversation-context.js";

interface Props {
  prompt: string;
  label: string;
  withCapabilities?: boolean;
}

export function A2uiSendButton({
  prompt,
  label,
  withCapabilities = true,
}: Props) {
  const sendPrompt = useA2uiSendPrompt();
  const conversation = useA2uiConversationState();
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  if (!sendPrompt) return null;
  function handleSend() {
    if (!sendPrompt) return;
    setState("sending");
    const text =
      withCapabilities && conversation
        ? conversation.withRendererMetadata(prompt)
        : prompt;
    sendPrompt(text)
      .then(() => setState("sent"))
      .catch((error: unknown) => {
        setState("idle");
        emitToast({
          kind: "error",
          message: error instanceof Error ? error.message : "Couldn't send it.",
        });
      });
  }
  return (
    <Button
      type="button"
      size="xs"
      variant="outline"
      disabled={state !== "idle"}
      onClick={handleSend}
      className="self-start"
    >
      {state === "sent" ? "Sent" : label}
    </Button>
  );
}
