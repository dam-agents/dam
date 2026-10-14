import { useState } from "react";

import { Button } from "@/components/ui/button";

import { emitToast } from "../../../lib/toast.js";
import { useA2uiSendPrompt } from "../contexts/a2ui-action-context.js";

interface Props {
  prompt: string;
  label: string;
}

export function A2uiSendButton({ prompt, label }: Props) {
  const sendPrompt = useA2uiSendPrompt();
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  if (!sendPrompt) return null;
  function handleSend() {
    if (!sendPrompt) return;
    setState("sending");
    sendPrompt(prompt)
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
