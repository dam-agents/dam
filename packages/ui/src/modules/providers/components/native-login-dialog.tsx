import { useState } from "react";

import { DialogBody, DialogHeader, Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";

import { Terminal } from "../../sessions/components/terminal.js";

export function NativeLoginDialog({
  agentId,
  sessionId,
  signedIn,
  onClose,
  onRetry,
  onExit,
}: {
  agentId: string;
  sessionId: string;
  signedIn: boolean;
  onClose: () => void;
  onRetry: () => void;
  onExit: () => void;
}) {
  const [exitCode, setExitCode] = useState<number | null>(null);
  return (
    <Modal size="lg" onClose={onClose}>
      <DialogHeader
        title="Sign in to ChatGPT on this agent"
        onClose={onClose}
      />
      <DialogBody>
        <p className="text-sm mb-3">
          Open the sign-in page, enter the code shown below, and approve access.
          Keep this window open until sign-in finishes.
        </p>
        <a
          href="https://auth.openai.com/codex/device"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline"
        >
          Open ChatGPT sign-in page
        </a>
        <div className="h-80 mt-3">
          <Terminal
            agentId={agentId}
            sessionId={sessionId}
            fresh
            nativeLogin
            onExit={(code) => {
              setExitCode(code);
              onExit();
            }}
          />
        </div>
        {exitCode !== null && exitCode !== 0 && (
          <div className="mt-3 space-y-2">
            <p role="status" className="text-sm">
              Sign-in didn’t finish. Get a new code and try again.
            </p>
            <Button size="sm" onClick={onRetry}>
              Get a new code
            </Button>
          </div>
        )}
        {signedIn && exitCode === 0 && (
          <p role="status" className="text-sm mt-3">
            ChatGPT sign-in completed. Close this window and retry your message.
            After reauthorizing an expired login or changing accounts, restart
            this agent before sending again.
          </p>
        )}
      </DialogBody>
    </Modal>
  );
}
