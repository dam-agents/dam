import { EdgeDevice, OverflowMenuVertical, Time } from "@carbon/icons-react";
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
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type {
  AgentDisplay,
  AgentDisplayState,
} from "../modules/agents/utils/agent-resolver.js";
import { ConnectionIcon } from "../modules/connections/components/connection-icon.js";
import type { SessionListInclude } from "../modules/sessions/api/queries.js";
import { useAcpSessions } from "../modules/sessions/api/queries.js";
import { useStore } from "../store.js";
import type { AgentView } from "../types.js";
import { SidebarSessionItem } from "./sidebar-session-item.js";

const STATE_DOT_COLORS: Partial<Record<AgentDisplayState, string>> = {
  running: "bg-green-500",
  running_always_on: "bg-green-500",
  starting: "bg-green-500",
  preparing_workspace: "bg-green-500",
  hibernated: "bg-blue-400",
  idle_always_on: "bg-blue-400",
  hibernating: "bg-muted-foreground/50",
  error: "bg-red-500",
  over_budget: "bg-amber-500",
};

const STATE_LABELS: Partial<Record<AgentDisplayState, string>> = {
  running: "Working",
  running_always_on: "Working",
  starting: "Starting",
  preparing_workspace: "Preparing",
  hibernated: "Idle",
  idle_always_on: "Idle",
  hibernating: "Hibernating",
  error: "Error",
  over_budget: "Over budget",
};

function formatCpu(raw: string): string {
  const m = raw.match(/^(\d+)m$/);
  if (m) return `${Number(m[1]) / 1000} CPU`;
  return `${raw} CPU`;
}

function formatMemory(raw: string): string {
  const gi = raw.match(/^(\d+)Gi$/);
  if (gi) return `${gi[1]} Gi`;
  const mi = raw.match(/^(\d+)Mi$/);
  if (mi) return `${mi[1]} Mi`;
  return raw;
}

function computeSubtitle(size: { cpu?: string; memory?: string }): string {
  const parts: string[] = [];
  if (size.cpu) parts.push(formatCpu(size.cpu));
  if (size.memory) parts.push(formatMemory(size.memory));
  return parts.join(" · ") || "";
}

const SIDEBAR_SESSION_INCLUDE: SessionListInclude = {
  channels: false,
  scheduled: false,
};

export interface SidebarAgentItemProps {
  agent: AgentView;
  display: AgentDisplay;
  scheduleCount: number;
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
  scheduleCount,
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
  const showMore = useStore((s) => s.showMoreSidebarSessions);
  const limit = useStore((s) => s.sidebarSessionLimits.get(agent.id) ?? 3);
  const selectedAgent = useStore((s) => s.selectedAgent);
  const active = selectedAgent === agent.id;

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

  const slackChannels = agent.channels.filter((c) => c.type === "slack") as {
    type: "slack";
    slackChannelId: string;
  }[];
  const hasSlack = slackChannels.length > 0;
  const hasSchedules = scheduleCount > 0;
  const subtitle = agent.size ? computeSubtitle(agent.size) : "";
  const dotColor = STATE_DOT_COLORS[display.state];
  const stateLabel = STATE_LABELS[display.state] ?? display.state;
  const isRunning =
    display.state === "running" || display.state === "running_always_on";

  return (
    <div>
      <div
        className={cn(
          "group/agent relative flex w-full gap-3 rounded-xl px-4 py-4 text-left transition-colors",
          active ? "bg-[#f4f4f4]/50 dark:bg-white/[0.03]" : "hover:bg-muted/50",
        )}
      >
        {/* Icon container — matches NotificationRow agent icon style */}
        <div className="relative shrink-0 pt-0.5">
          <div className="flex size-10 items-center justify-center rounded-xl bg-[#f2f4f8] text-foreground dark:bg-white/10">
            <EdgeDevice size={16} />
          </div>
          {isRunning && (
            <span className="working-dots absolute -left-[8px] top-0 flex items-center -space-x-[1px]">
              <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
              <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
              <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
            </span>
          )}
          {!isRunning && dotColor && (
            <Tooltip content={stateLabel} side="right">
              <span
                className={cn(
                  "absolute -left-0.5 top-0 size-2.5 rounded-full border-2 border-background",
                  dotColor,
                )}
              />
            </Tooltip>
          )}
        </div>

        <button
          type="button"
          onClick={() => toggle(agent.id)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex items-baseline gap-1 text-sm leading-snug">
            <p className="min-w-0 truncate">
              <span className="font-semibold text-foreground">
                {agent.name}
              </span>
            </p>
          </div>

          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            {subtitle && <span className="truncate">{subtitle}</span>}
            {hasSlack && (
              <>
                {subtitle && <span className="text-border">·</span>}
                <ConnectionIcon
                  iconSlug="slack"
                  alt="Slack"
                  size={16}
                  className="shrink-0 opacity-60"
                />
                <span className="shrink-0">{slackChannels.length}</span>
              </>
            )}
            {hasSchedules && (
              <>
                {(subtitle || hasSlack) && (
                  <span className="text-border">·</span>
                )}
                <Time size={16} className="shrink-0 opacity-60" />
                <span className="shrink-0">{scheduleCount}</span>
              </>
            )}
          </p>
        </button>

        <div
          className="flex shrink-0 items-start pt-0.5 opacity-0 transition-opacity group-hover/agent:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
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
      </div>

      {expanded && (
        <div className="ml-8 mt-1 flex flex-col gap-0.5 border-l border-border pl-3">
          {isFetching && !sessions && (
            <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
              <Spinner className="size-3" />
              <span>Loading…</span>
            </div>
          )}
          {sessions && sessions.length === 0 && (
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
            />
          ))}
          {hasMore && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                showMore(agent.id);
              }}
              className="px-2 py-1 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Show more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
