import type { AgentView } from "../../../types.js";
import {
  AgentAvatar,
  type AgentAvatarMood,
} from "../../agents/components/avatar/agent-avatar.js";
import { NewAvatarDot } from "../../agents/components/avatar/new-avatar-dot.js";
import { useFreshAvatars } from "../../getting-started/hooks/use-unlocked-avatars.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Agent's avatar and name at the start of the
 * chat's top bar, as one button that opens the Agent's settings over the
 * chat. The avatar keeps the dot that says a new avatar is waiting, since the
 * avatar picker is one click away in those settings.
 */
export function AgentSettingsButton({
  agent,
  mood,
  onClick,
}: {
  agent: AgentView;
  mood: AgentAvatarMood;
  onClick: () => void;
}) {
  const hasNewAvatar = useFreshAvatars().length > 0;
  return (
    <h1 className="flex min-w-0">
      <button
        type="button"
        onClick={onClick}
        aria-label={`Configure ${agent.name}`}
        data-testid="chat-agent-identity"
        className="-ml-1 flex min-w-0 items-center gap-3 rounded-lg py-1 pr-2 pl-1 text-sm font-bold text-foreground transition-colors hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="relative shrink-0">
          <AgentAvatar
            name={agent.name}
            avatar={agent.avatar}
            size={32}
            mood={mood}
          />
          {hasNewAvatar && <NewAvatarDot className="-top-1 -right-1" />}
        </span>
        <span className="truncate">{agent.name}</span>
      </button>
    </h1>
  );
}
