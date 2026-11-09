import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import {
  AgentSpeaker,
  SpeakerRow,
} from "../../sessions/components/chat-message-speaker.js";
import { draftKey } from "../../sessions/lib/draft-key.js";
import type { GreetingCopy } from "../lib/greeting.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the greeting an unused assistant opens its chat
 * with, shown where the transcript would start: its avatar and name, what it
 * asks of the owner, and the tasks it offers. A task goes into the composer for
 * the owner to send or edit, so nothing runs before they act.
 */
export function AssistantGreeting({
  greeting,
  avatar,
  agentId,
  sessionId,
  onConfigure,
  onPicked,
}: {
  greeting: GreetingCopy;
  avatar: string | null;
  agentId: string;
  sessionId: string | null;
  onConfigure: () => void;
  onPicked: () => void;
}) {
  const setDraft = useStore((s) => s.setDraft);
  return (
    <div data-testid="assistant-greeting" className="flex flex-col gap-4">
      <SpeakerRow agentName={greeting.assistantName} onAgentClick={onConfigure}>
        <AgentSpeaker agent={{ name: greeting.assistantName, avatar }} />
      </SpeakerRow>
      <div className="flex flex-col gap-4 text-sm text-foreground">
        {greeting.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {greeting.suggestions.map((suggestion) => (
          <Button
            key={suggestion}
            variant="outline"
            size="sm"
            onClick={() => {
              setDraft(draftKey(agentId, sessionId), { text: suggestion });
              onPicked();
            }}
          >
            {suggestion}
          </Button>
        ))}
      </div>
    </div>
  );
}
