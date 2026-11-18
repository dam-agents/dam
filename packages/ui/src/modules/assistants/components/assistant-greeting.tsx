import { ChevronDown } from "@carbon/icons-react";
import type { AssistantIdea } from "api-server-api";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import {
  AgentSpeaker,
  SpeakerRow,
} from "../../sessions/components/chat-message-speaker.js";
import { draftKey } from "../../sessions/lib/draft-key.js";
import type { GreetingCopy } from "../lib/greeting.js";

function IdeaChip({
  idea,
  agentId,
  sessionId,
  onPicked,
}: {
  idea: AssistantIdea;
  agentId: string;
  sessionId: string | null;
  onPicked: () => void;
}) {
  const setDraft = useStore((s) => s.setDraft);
  return (
    <Button
      variant="outline"
      size="sm"
      data-idea
      onClick={() => {
        const key = draftKey(agentId, sessionId);
        const typed = useStore.getState().drafts[key]?.text ?? "";
        setDraft(key, {
          text: typed.length > 0 ? `${typed}\n\n${idea.text}` : idea.text,
        });
        onPicked();
      }}
      className="h-auto min-h-10 max-w-full gap-1 rounded-full px-5 py-2 whitespace-normal text-left"
    >
      <span className="shrink-0 font-semibold">{idea.label}:</span>{" "}
      <span>{idea.text}</span>
    </Button>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the ideas the greeting offers, one chip each. An
 * idea's text — never its label, which is the kind of work, not a message — goes
 * into the composer for the owner to send or edit, so nothing runs before they
 * act.
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
  return (
    <div className="flex flex-col items-start gap-2">
      {ideas.map((idea) => (
        <IdeaChip
          key={idea.label}
          idea={idea}
          agentId={agentId}
          sessionId={sessionId}
          onPicked={onPicked}
        />
      ))}
    </div>
  );
}

const FIRST_IDEAS = 3;

/**
 * UNIT_BOUNDARY_DESCRIPTION: "Try something new", the row above the composer in
 * every chat of the assistant once the greeting is gone. It starts collapsed so
 * it never crowds the conversation; opened, it shows the first three ideas and
 * "Show all" for the rest. The caller leaves out the idea the chat started from.
 */
export function TrySomethingNew({
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
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (all)
      rowRef.current
        ?.querySelectorAll<HTMLButtonElement>("[data-idea]")
        [FIRST_IDEAS]?.focus();
  }, [all]);
  const shown = all ? ideas : ideas.slice(0, FIRST_IDEAS);
  return (
    <div
      ref={rowRef}
      data-testid="try-something-new"
      className="flex flex-wrap items-center gap-2 pb-3"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-md px-1 py-1 text-sm text-foreground outline-none hover:text-foreground/80 focus-visible:ring-2 focus-visible:ring-ring"
      >
        Try something new
        <ChevronDown
          size={16}
          aria-hidden
          className={cn("transition-transform", open && "rotate-180")}
        />
      </button>
      {open &&
        shown.map((idea) => (
          <IdeaChip
            key={idea.label}
            idea={idea}
            agentId={agentId}
            sessionId={sessionId}
            onPicked={onPicked}
          />
        ))}
      {open && !all && ideas.length > FIRST_IDEAS && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAll(true)}
          className="h-10 rounded-full border-dashed px-4"
        >
          Show all {ideas.length}
        </Button>
      )}
    </div>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the greeting an unused assistant opens its chat
 * with, shown where the transcript would start: its avatar and name, where the
 * person changes its provider, and the five ideas it offers.
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
      <div className="flex flex-col gap-4 text-[15px] leading-[1.72] text-foreground">
        <p>
          {greeting.opening} {greeting.settingsPrefix}{" "}
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
