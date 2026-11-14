import type { AssistantIdea } from "api-server-api";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import {
  AgentSpeaker,
  SpeakerRow,
} from "../../sessions/components/chat-message-speaker.js";
import { draftKey } from "../../sessions/lib/draft-key.js";
import type { GreetingCopy } from "../lib/greeting.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the ideas the assistant offers, one chip each. An
 * idea's text — never its label, which is the kind of work, not a message — goes
 * into the composer for the owner to send or edit, so nothing runs before they
 * act; the chips are not the greeting, which is said once, and they stay on
 * every new chat of the assistant's own.
 */
export function AssistantIdeas({
  ideas,
  agentId,
  sessionId,
  onPicked,
}: {
  ideas: readonly AssistantIdea[];
  agentId: string;
  sessionId: string | null;
  onPicked: () => void;
}) {
  const setDraft = useStore((s) => s.setDraft);
  return (
    <div className="flex flex-col items-start gap-2">
      {ideas.map((idea) => (
        <Button
          key={idea.label}
          variant="outline"
          size="sm"
          onClick={() => {
            const key = draftKey(agentId, sessionId);
            const typed = useStore.getState().drafts[key]?.text ?? "";
            setDraft(key, {
              text: typed.length > 0 ? `${typed}\n\n${idea.text}` : idea.text,
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
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the greeting an unused assistant opens its chat
 * with, shown where the transcript would start: its avatar and name, what it is
 * set up with, where the person changes that, and the five ideas it offers.
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
      <AssistantIdeas
        ideas={greeting.ideas}
        agentId={agentId}
        sessionId={sessionId}
        onPicked={onPicked}
      />
    </div>
  );
}
