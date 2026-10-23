import {
  ArrowLeft,
  EdgeDevice,
  OverflowMenuVertical,
  SendAltFilled,
  Settings,
  Time,
} from "@carbon/icons-react";
import type { SessionView } from "api-server-api";
import { useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import { timeAgo } from "../../../lib/format-time.js";
import { useStore } from "../../../store.js";
import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import { useAcpSessions } from "../../sessions/api/queries.js";
import { useAgentsList } from "../api/queries.js";
import type { AgentDisplayState } from "../utils/agent-resolver.js";
import { resolveAgentDisplay } from "../utils/agent-resolver.js";

type LandingSession = SessionView & { slackChannel?: string };

const BLUE_BADGE =
  "border-transparent bg-blue-50 text-blue-600 hover:bg-blue-50 dark:bg-blue-950 dark:text-blue-400 dark:hover:bg-blue-950";

type SessionFilter = "all" | "chats" | "scheduled" | "channels";

const FILTER_LABELS: Record<SessionFilter, string> = {
  all: "All",
  chats: "Chats",
  scheduled: "Scheduled",
  channels: "Channels",
};

function AgentStateBadge({ state }: { state: AgentDisplayState }) {
  if (state === "running" || state === "running_always_on")
    return <Badge variant="success">Working</Badge>;
  if (state === "hibernated" || state === "idle_always_on")
    return <Badge className={BLUE_BADGE}>Idle</Badge>;
  if (state === "hibernating")
    return <Badge variant="muted">Hibernating</Badge>;
  if (state === "starting" || state === "preparing_workspace")
    return <Badge variant="success">Working</Badge>;
  if (state === "error") return <Badge variant="danger">Error</Badge>;
  if (state === "over_budget")
    return <Badge variant="warning">Over budget</Badge>;
  return <Badge variant="muted">{state}</Badge>;
}

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

function agentInitials(name: string): string {
  const words = name.split(/[-_\s]+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

type ChannelKind = "agent" | "slack" | "schedule";

const iconBg: Record<ChannelKind, string> = {
  agent: "bg-[#f2f4f8] text-foreground dark:bg-white/10",
  slack:
    "bg-white border border-[#dde1e6] dark:bg-white/5 dark:border-white/10",
  schedule:
    "bg-[#edf5ff] text-[#0f62fe] dark:bg-[#0f62fe]/15 dark:text-[#78a9ff]",
};

function channelKindFor(session: LandingSession): ChannelKind {
  if (session.scheduleId || session.type === "schedule_cron") return "schedule";
  if (
    session.threadTs ||
    session.type === "channel_slack" ||
    session.slackChannel
  )
    return "slack";
  return "agent";
}

function channelIcon(kind: ChannelKind) {
  switch (kind) {
    case "schedule":
      return <Time size={16} />;
    case "slack":
      return <img src="/icons/slack.svg" alt="Slack" className="size-4" />;
    case "agent":
      return <EdgeDevice size={16} />;
  }
}

interface SessionRowProps {
  agentId: string;
  session: LandingSession;
}

function SessionRow({ agentId, session }: SessionRowProps) {
  const openAgentSession = useStore((s) => s.openAgentSession);
  const running = !!session.running;
  const unread =
    !!session.updatedAt &&
    !!session.seenAt &&
    new Date(session.updatedAt) > new Date(session.seenAt);
  const isRead = !running && !unread;
  const kind = channelKindFor(session);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openAgentSession(agentId, session.sessionId)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openAgentSession(agentId, session.sessionId);
        }
      }}
      className={cn(
        "group/row flex w-full gap-3 rounded-xl px-4 py-4 text-left transition-colors cursor-pointer hover:bg-muted/50",
        (unread || running) && "bg-[#f4f4f4]/50 dark:bg-white/[0.03]",
      )}
    >
      <div className="relative shrink-0 pt-0.5">
        <div
          className={cn(
            "flex size-10 items-center justify-center rounded-xl",
            iconBg[kind],
          )}
        >
          {channelIcon(kind)}
        </div>
        {running && (
          <span className="working-dots absolute -left-[8px] top-0 flex items-center -space-x-[1px]">
            <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
            <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
            <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
          </span>
        )}
        {unread && !running && (
          <span className="absolute -left-0.5 top-0 size-2.5 rounded-full border-2 border-background bg-accent" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1 text-sm leading-snug">
          <p
            className={cn(
              "min-w-0 truncate",
              !isRead
                ? "font-semibold text-foreground"
                : "text-muted-foreground",
            )}
          >
            {session.title || session.sessionId.slice(0, 12)}
          </p>
          {session.slackChannel && (
            <span className="shrink-0 text-muted-foreground/60">
              #{session.slackChannel}
            </span>
          )}
        </div>
        {session.updatedAt && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {timeAgo(session.updatedAt)}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-start pt-0.5 opacity-0 transition-opacity group-hover/row:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label="Session actions"
              onClick={(e) => e.stopPropagation()}
            >
              <OverflowMenuVertical size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem tone="danger">Delete session</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export function AgentLandingView() {
  const agentId = useStore((s) => s.agentId ?? s.selectedAgent);
  const agents = useAgentsList();
  const restartingAgents = useStore((s) => s.restartingAgents);
  const pausingAgents = useStore((s) => s.pausingAgents);
  const goBack = useStore((s) => s.goBack);
  const selectAgent = useStore((s) => s.selectAgent);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);

  const [filter, setFilter] = useState<SessionFilter>("all");
  const [inputValue, setInputValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const agent = agents.find((a) => a.id === agentId);

  const restartingIds = useMemo(
    () => new Set(restartingAgents.keys()),
    [restartingAgents],
  );
  const pausingIds = useMemo(
    () => new Set(pausingAgents.keys()),
    [pausingAgents],
  );

  const display = agent
    ? resolveAgentDisplay(agent, restartingIds, pausingIds)
    : null;

  const { data: rawSessions } = useAcpSessions(agentId, {
    channels: true,
    scheduled: true,
  });
  const sessions = rawSessions as LandingSession[] | undefined;

  const filteredSessions = useMemo(() => {
    if (!sessions) return [];
    if (filter === "all") return sessions;
    return sessions.filter((s) => {
      if (filter === "scheduled")
        return s.type === "schedule_cron" || s.scheduleId;
      if (filter === "channels")
        return (
          s.type === "channel_slack" ||
          s.type === "channel_telegram" ||
          s.threadTs
        );
      return (
        s.type === "regular" ||
        (!s.scheduleId && !s.threadTs && s.type !== "channel_slack")
      );
    });
  }, [sessions, filter]);

  const scheduleCount = useMemo(() => {
    if (!sessions) return 0;
    return sessions.filter((s) => s.type === "schedule_cron" || s.scheduleId)
      .length;
  }, [sessions]);

  if (!agent || !display) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        Agent not found
      </div>
    );
  }

  const slackChannels = agent.channels.filter((c) => c.type === "slack") as {
    type: "slack";
    slackChannelId: string;
  }[];

  const computeParts: string[] = [];
  if (agent.size.cpu) computeParts.push(formatCpu(agent.size.cpu));
  if (agent.size.memory) computeParts.push(formatMemory(agent.size.memory));
  const computeLabel = computeParts.join(" · ");

  const handleNewSession = () => {
    if (!agentId || !inputValue.trim()) return;
    selectAgent(agentId);
  };

  return (
    <div className="mx-auto w-full max-w-[800px] px-4 py-6 pb-20 md:px-[5%]">
      <button
        type="button"
        onClick={goBack}
        className="mb-6 flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft size={16} />
        Back
      </button>

      <div className="flex items-start gap-5">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-[#dde1e6] bg-white text-lg font-bold text-foreground dark:border-white/10 dark:bg-white/5">
          {agentInitials(agent.name)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <h1 className="min-w-0 truncate text-2xl font-bold text-foreground">
              {agent.name}
            </h1>
            <AgentStateBadge state={display.state} />
          </div>

          {agent.description && (
            <p className="mt-1 text-sm text-muted-foreground">
              {agent.description}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {computeLabel && (
              <Badge variant="outline" className="gap-1">
                {computeLabel}
              </Badge>
            )}
            {slackChannels.length > 0 && (
              <Badge variant="muted" className="gap-1.5">
                <ConnectionIcon iconSlug="slack" alt="" size={16} />
                {slackChannels
                  .slice(0, 3)
                  .map((ch) => ch.slackChannelId)
                  .join(", ")}
                {slackChannels.length > 3 && `, +${slackChannels.length - 3}`}
              </Badge>
            )}
            {scheduleCount > 0 && (
              <Badge variant="muted" className="gap-1.5">
                <Time size={16} />
                {scheduleCount} active schedule
                {scheduleCount === 1 ? "" : "s"}
              </Badge>
            )}
          </div>
        </div>

        <div className="shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Agent actions">
                <OverflowMenuVertical size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => agentId && navigateToSandboxHome(agentId)}
              >
                <Settings size={16} />
                Configure agent
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem tone="danger">Delete agent</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="mt-8">
        <div className="flex flex-col rounded-xl border border-border bg-background transition-colors focus-within:border-primary">
          <div className="flex items-end gap-1 px-2 min-h-[56px]">
            <div className="relative flex-1">
              <textarea
                ref={textareaRef}
                rows={1}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleNewSession();
                  }
                }}
                placeholder="Message..."
                className="w-full bg-transparent border-0 pl-2 pr-2 py-[17px] text-sm leading-[22px] text-foreground caret-foreground resize-none min-h-0 max-h-[50vh] overflow-hidden placeholder:text-muted-foreground/50 focus:outline-none focus:ring-0"
              />
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                "shrink-0 mb-[9px] h-10 w-10",
                inputValue.trim() ? "text-foreground" : "text-muted-foreground",
              )}
              onClick={handleNewSession}
              disabled={!inputValue.trim()}
              aria-label="Send"
            >
              <SendAltFilled size={16} />
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-8">
        <div className="flex items-center justify-between">
          <SectionLabel>Activity</SectionLabel>
          <div className="flex gap-1">
            {(Object.keys(FILTER_LABELS) as SessionFilter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm transition-colors",
                  filter === f
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {FILTER_LABELS[f]}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          {filteredSessions.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {filter === "all"
                ? "No sessions yet"
                : `No ${FILTER_LABELS[filter].toLowerCase()} sessions`}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {filteredSessions.map((s) => (
                <SessionRow key={s.sessionId} agentId={agent.id} session={s} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
