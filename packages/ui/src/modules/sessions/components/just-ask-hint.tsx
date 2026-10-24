import { Close } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

import type { JustAskHint as Hint } from "../store/side-panel.js";
import { AgentSpeaker, SpeakerRow } from "./chat-message-speaker.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the client's own message in the conversation,
 * after a schedule was created in the side panel beside it: not a Session
 * message, so it has no id, no reply and no place in the record, and it goes
 * away with the next one or with its X.
 */
export function JustAskHint({
  hint,
  agentName,
  avatar,
  onDismiss,
}: {
  hint: Hint;
  agentName: string;
  avatar: string | null;
  onDismiss: () => void;
}) {
  return (
    <div data-testid="just-ask-hint" className="flex flex-col gap-1.5">
      <SpeakerRow agentName={agentName}>
        <AgentSpeaker agent={{ name: agentName, avatar }} />
      </SpeakerRow>
      <div className="flex items-start gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground">
        <p className="min-w-0 flex-1">
          Next time, just ask:{" "}
          <span className="font-medium">{hint.prompt}</span>
        </p>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Dismiss"
          tooltip="Dismiss"
          onClick={onDismiss}
          className="-my-1 -mr-2 shrink-0"
        >
          <Close size={16} />
        </Button>
      </div>
    </div>
  );
}
