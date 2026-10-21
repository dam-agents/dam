import type { ReactNode } from "react";

import { AgentAvatar } from "../../agents/components/avatar/agent-avatar.js";

export interface SpeakerAgent {
  name: string;
  avatar: string | null;
}

export function AgentSpeaker({ agent }: { agent?: SpeakerAgent }) {
  return (
    <>
      {agent !== undefined && (
        <AgentAvatar
          name={agent.name}
          avatar={agent.avatar}
          size={32}
          className="shrink-0"
        />
      )}
      <span className="truncate text-sm font-semibold text-foreground">
        {agent?.name ?? "Agent"}
      </span>
    </>
  );
}

interface SpeakerRowProps {
  agentName?: string;
  onAgentClick?: () => void;
  children: ReactNode;
}

export function SpeakerRow({
  agentName,
  onAgentClick,
  children,
}: SpeakerRowProps) {
  return (
    <div className="mb-0.5 flex max-w-full">
      {onAgentClick ? (
        <button
          type="button"
          onClick={onAgentClick}
          aria-label={`Configure ${agentName ?? "agent"}`}
          className="flex min-w-0 items-center gap-2 rounded-md text-left hover:opacity-80"
        >
          {children}
        </button>
      ) : (
        <div className="flex min-w-0 items-center gap-2">{children}</div>
      )}
    </div>
  );
}
