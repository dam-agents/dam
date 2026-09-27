import { OverflowMenuVertical, Time } from "@carbon/icons-react";
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

  const metaParts: string[] = [];
  if (subtitle) metaParts.push(subtitle);
  if (hasSlack) metaParts.push(`Slack · ${slackChannels.length}`);
  if (hasSchedules)
    metaParts.push(
      `${scheduleCount} schedule${scheduleCount === 1 ? "" : "s"}`,
    );

  return (
    <div>
      <div
        className={cn(
          "group/agent relative flex gap-3 rounded-lg px-2.5 py-2.5 transition-colors",
          active
            ? "bg-muted text-foreground"
            : "text-foreground/80 hover:bg-muted hover:text-foreground",
        )}
      >
        {/* Avatar placeholder */}
        <div className="relative mt-0.5 size-8 shrink-0 rounded-md border border-border bg-white">
          {dotColor && (
            <Tooltip content={stateLabel} side="right">
              <span
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-card",
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
          <span className="block min-w-0 truncate text-sm font-medium">
            {agent.name}
          </span>

          {metaParts.length > 0 && (
            <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
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
            </span>
          )}
        </button>

        <div
          className="absolute right-1 top-1 opacity-0 transition-opacity group-hover/agent:opacity-100"
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
              {(display.state === "running" ||
                display.state === "running_always_on") && (
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
        <div className="ml-6 mt-1 flex flex-col gap-0.5 border-l border-border pl-2.5">
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
