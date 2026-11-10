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
 * with, shown where the transcript would start: its avatar and name, what it is
 * set up with, where the person changes that, and the five ideas it offers.
 * An idea goes into the composer for the owner to send or edit, so nothing runs
 * before they act.
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
        <p>
          {greeting.opening}
          {greeting.provider ? ` ${greeting.provider}` : ""}{" "}
          {greeting.settingsPrefix}{" "}
          <Button
            variant="link"
            size="inline"
            onClick={onConfigure}
            data-testid="assistant-greeting-settings"
          >
            {greeting.settingsLink}
          </Button>
          .
        </p>
        <p>{greeting.learn}</p>
      </div>
      <div className="flex flex-col items-start gap-2">
        {greeting.ideas.map((idea) => (
          <Button
            key={idea.label}
            variant="outline"
            size="sm"
            onClick={() => {
              setDraft(draftKey(agentId, sessionId), {
                text: `${idea.label}: ${idea.text}`,
              });
              onPicked();
            }}
            className="h-10 max-w-full rounded-full px-5 whitespace-normal text-left"
          >
            <span className="shrink-0 font-semibold">{idea.label}:</span>{" "}
            {idea.text}
          </Button>
        ))}
      </div>
    </div>
  );
}
