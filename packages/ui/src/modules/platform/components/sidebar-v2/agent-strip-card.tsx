import { AddComment, Tools } from "@carbon/icons-react";
import { isStartRefusal } from "api-server-api";

import { StatusBadge } from "@/components/status-indicator";
import { RAIL_BADGE, railIndicator } from "@/components/ui/rail-tile";
import { Tooltip } from "@/components/ui/tooltip";
import { clickableProps } from "@/lib/clickable";
import { cn } from "@/lib/utils";

import type { AgentView } from "../../../../types.js";
import {
  AgentAvatar,
  avatarMood,
} from "../../../agents/components/avatar/agent-avatar.js";
import { UpdateAvailableAction } from "../../../agents/components/update-available-action.js";
import { useResolvedAgentDisplay } from "../../../agents/hooks/use-resolved-agent-display.js";

export function AgentStripCard({
  agent,
  active,
  current,
  badge,
  working,
  updating,
  updateBusy,
  onSelect,
  onUpdate,
  onNewSession,
  onConfigure,
}: {
  agent: AgentView;
  active: boolean;
  current: boolean;
  badge: number;
  working: boolean;
  updating: boolean;
  updateBusy: boolean;
  onSelect: () => void;
  onUpdate: () => void;
  onNewSession: () => void;
  onConfigure: () => void;
}) {
  const mood = avatarMood(agent.state, agent);
  const display = useResolvedAgentDisplay(agent);
  return (
    <div
      {...clickableProps(onSelect)}
      aria-current={active ? "page" : undefined}
      aria-label={badge > 0 ? `${agent.name}, ${badge} need you` : agent.name}
      data-testid="sidebar-strip-card"
      className={cn(
        "group relative flex cursor-pointer flex-col gap-2 rounded-xl border px-2.5 pt-2.5 pb-2 text-left transition-colors select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-border-ui bg-muted"
          : "border-border bg-background hover:bg-muted/60",
      )}
    >
      <span aria-hidden className={railIndicator("left", active, current)} />
      <div className="flex min-w-0 items-center gap-2.5">
        <AgentAvatar
          name={agent.name}
          avatar={agent.avatar}
          size={36}
          mood={mood}
          className="shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div
            title={agent.name}
            className={cn(
              "truncate text-sm font-semibold",
              mood === "awake" ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {agent.name}
          </div>
          <StatusBadge
            state={display?.state ?? agent.state}
            working={working}
            vm={agent.vm}
            refused={isStartRefusal(agent.podTerminationCode)}
            className="mt-0.5 px-2 py-0 text-[11px]"
          />
        </div>
      </div>
      <div className="flex min-h-7 items-center gap-1">
        <UpdateAvailableAction
          agent={agent}
          pending={updating}
          busy={updateBusy}
          onUpdate={onUpdate}
        />
        <div className="ml-auto flex items-center">
          <CardIcon label="New session" onClick={onNewSession}>
            <AddComment size={16} />
          </CardIcon>
          <CardIcon label="Configure agent" onClick={onConfigure}>
            <Tools size={14} />
          </CardIcon>
        </div>
      </div>
      {badge > 0 && (
        <span className={cn(RAIL_BADGE, "bg-warning")}>
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </div>
  );
}

function CardIcon({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip content={label} side="bottom">
      <button
        type="button"
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
      >
        {children}
      </button>
    </Tooltip>
  );
}
