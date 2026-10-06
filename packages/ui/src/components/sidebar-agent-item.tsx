import {
  ChevronDown,
  ChevronRight,
  OverflowMenuVertical,
} from "@carbon/icons-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import type { AgentDisplay } from "../modules/agents/utils/agent-resolver.js";
import type { SessionListInclude } from "../modules/sessions/api/queries.js";
import { useAcpSessions } from "../modules/sessions/api/queries.js";
import { useStore } from "../store.js";
import type { AgentView } from "../types.js";
import { SidebarSessionItem } from "./sidebar-session-item.js";
import { stateDotClass } from "./status-indicator.js";

const SIDEBAR_SESSION_INCLUDE: SessionListInclude = {
  channels: false,
  scheduled: false,
};

export interface SidebarAgentItemProps {
  agent: AgentView;
  display: AgentDisplay;
  deletePending: boolean;
  onConfigure: () => void;
  onWake: () => void;
  onRestart: () => void;
  onPause: () => void;
  onStop: () => void;
  onDelete: () => void;
}

export function SidebarAgentItem({
  agent,
  display,
  deletePending,
  onConfigure,
  onWake,
  onRestart,
  onPause,
  onStop,
  onDelete,
}: SidebarAgentItemProps) {
  const expanded = useStore((s) => s.expandedSidebarAgents.has(agent.id));
  const toggle = useStore((s) => s.toggleSidebarAgent);
  const selectAgent = useStore((s) => s.selectAgent);
  const limit = useStore((s) => s.sidebarSessionLimits.get(agent.id) ?? 3);
  const selectedAgent = useStore((s) => s.selectedAgent);
  const active = selectedAgent === agent.id;
  const isRunning =
    display.state === "running" || display.state === "running_always_on";

  const { data: sessions, isFetching } = useAcpSessions(
    agent.id,
    SIDEBAR_SESSION_INCLUDE,
    { enabled: expanded },
  );

  const visibleSessions = useMemo(
    () => (sessions ?? []).slice(0, limit),
    [sessions, limit],
  );
  const hasMore = (sessions?.length ?? 0) > limit;

  return (
    <div className="mb-2">
      <div
        className={cn(
          "group/agent relative flex w-full items-center gap-1.5 px-4 py-2.5 text-left transition-colors",
          active ? "bg-muted/60 dark:bg-white/[0.04]" : "hover:bg-muted/40",
        )}
      >
        <button
          type="button"
          onClick={() => toggle(agent.id)}
          className="flex shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          aria-label={expanded ? "Collapse sessions" : "Expand sessions"}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            stateDotClass[display.state],
          )}
        />
        <button
          type="button"
          onClick={() => selectAgent(agent.id)}
          className="min-w-0 flex-1 text-left"
        >
          <p className="truncate text-[15px] font-semibold text-foreground leading-snug hover:text-primary transition-colors">
            {agent.name}
          </p>
        </button>
        <div className="shrink-0 opacity-0 transition-opacity group-hover/agent:opacity-100">
          <OverflowMenu
            display={display}
            isRunning={isRunning}
            deletePending={deletePending}
            onConfigure={onConfigure}
            onWake={onWake}
            onRestart={onRestart}
            onPause={onPause}
            onStop={onStop}
            onDelete={onDelete}
          />
        </div>
      </div>

      {expanded && (
        <div className="ml-4">
          {isFetching && !sessions && (
            <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
              <Spinner className="size-3" />
              <span>Loading…</span>
            </div>
          )}
          {sessions?.length === 0 && (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">
              No sessions yet
            </p>
          )}
          {visibleSessions.map((s) => (
            <SidebarSessionItem
              key={s.sessionId}
              agentId={agent.id}
              sessionId={s.sessionId}
              title={s.title}
              running={!!s.running}
              updatedAt={s.updatedAt}
              seenAt={s.seenAt ?? null}
              slackChannel={s.slackChannel ?? null}
              scheduleId={s.scheduleId ?? null}
              threadTs={s.threadTs ?? null}
              onDelete={() => {
                // TODO: wire to actual session delete mutation
              }}
            />
          ))}
          {hasMore && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                selectAgent(agent.id);
              }}
              className="px-2 py-1 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              View all sessions
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function OverflowMenu({
  display,
  isRunning,
  deletePending,
  onConfigure,
  onWake,
  onRestart,
  onPause,
  onStop,
  onDelete,
}: {
  display: AgentDisplay;
  isRunning: boolean;
  deletePending: boolean;
  onConfigure: () => void;
  onWake: () => void;
  onRestart: () => void;
  onPause: () => void;
  onStop: () => void;
  onDelete: () => void;
}) {
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Agent actions"
          >
            <OverflowMenuVertical size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onConfigure}>
            Configure agent
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {display.powerAction === "start" ? (
            <DropdownMenuItem onSelect={onWake}>
              {display.state === "over_budget" ? "Start" : "Wake"}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              disabled={display.powerAction === null}
              onSelect={onRestart}
            >
              Restart
            </DropdownMenuItem>
          )}
          {isRunning && (
            <>
              <DropdownMenuItem onSelect={onPause}>
                Pause — wakes on next use
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onStop}>
                Stop — until started again
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            tone="danger"
            disabled={deletePending}
            onSelect={onDelete}
          >
            Delete agent
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
