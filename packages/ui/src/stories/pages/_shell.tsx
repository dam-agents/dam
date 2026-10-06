import type { CarbonIconType } from "@carbon/icons-react";
import {
  Add,
  Checkmark,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Close,
  Cube,
  Filter,
  Folders,
  Help,
  Home,
  NewTab,
  OverflowMenuVertical,
  Settings,
  Time,
  TrashCan,
} from "@carbon/icons-react";
import type { Decorator } from "@storybook/react-vite";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SectionLabel } from "@/components/ui/section-label";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AgentAvatar } from "@/modules/agents/components/avatar/agent-avatar";

type AgentState = "running" | "hibernated" | "hibernating";

interface MockSession {
  id: string;
  title: string;
  running: boolean;
  unread: boolean;
  time: string;
  slack?: string;
  schedule?: boolean;
}

interface MockAgent {
  id: string;
  name: string;
  state: AgentState;
  sessions: MockSession[];
}

const mockAgents: MockAgent[] = [
  {
    id: "a1",
    name: "ci-pipeline",
    state: "running",
    sessions: [
      {
        id: "s1",
        title: "Fix login redirect loop",
        running: true,
        unread: false,
        time: "2m ago",
      },
      {
        id: "s2",
        title: "Review PR #482 auth changes",
        running: false,
        unread: true,
        time: "25m ago",
      },
      {
        id: "s3",
        title: "Investigate flaky test suite",
        running: false,
        unread: false,
        time: "1h ago",
      },
      {
        id: "s4x",
        title: "Deploy staging v2.3.1",
        running: false,
        unread: false,
        time: "2h ago",
      },
      {
        id: "s4y",
        title: "Run migration dry-run",
        running: false,
        unread: false,
        time: "4h ago",
      },
    ],
  },
  {
    id: "a2",
    name: "code-review-bot",
    state: "running",
    sessions: [
      {
        id: "s4",
        title: "Audit PR #501 perf regression",
        running: true,
        unread: false,
        time: "8m ago",
        slack: "dev-reviews",
      },
      {
        id: "s5",
        title: "Lint sweep for deprecated APIs",
        running: false,
        unread: false,
        time: "3h ago",
      },
    ],
  },
  {
    id: "a3",
    name: "bug-triage",
    state: "hibernated",
    sessions: [
      {
        id: "s6",
        title: "Triage issue #1204",
        running: false,
        unread: true,
        time: "3h ago",
      },
    ],
  },
  {
    id: "a4",
    name: "api-docs",
    state: "hibernated",
    sessions: [
      {
        id: "s7",
        title: "Update API reference v3",
        running: false,
        unread: false,
        time: "5h ago",
      },
    ],
  },
  { id: "a5", name: "pm-standup", state: "hibernating", sessions: [] },
];

type ChannelType = "chat" | "slack" | "telegram" | "schedule" | "terminal";

const CHANNEL_TYPES: readonly ChannelType[] = [
  "chat",
  "slack",
  "telegram",
  "schedule",
  "terminal",
];

const CHANNEL_TYPE_LABELS: Record<ChannelType, string> = {
  chat: "Chat",
  slack: "Slack",
  telegram: "Telegram",
  schedule: "Schedule",
  terminal: "Terminal",
};

type StateFilter = "any" | "attention" | "in-progress" | "unread";

const STATE_FILTERS: readonly StateFilter[] = [
  "any",
  "attention",
  "in-progress",
  "unread",
];

const STATE_FILTER_LABELS: Record<StateFilter, string> = {
  any: "All",
  attention: "Needs attention",
  "in-progress": "In progress",
  unread: "Unread",
};

interface ActivityFilter {
  channelTypes: ReadonlySet<ChannelType>;
  state: StateFilter;
}

function defaultActivityFilter(): ActivityFilter {
  return { channelTypes: new Set(CHANNEL_TYPES), state: "any" };
}

function isActivityFiltered(filter: ActivityFilter): boolean {
  return (
    filter.channelTypes.size < CHANNEL_TYPES.length || filter.state !== "any"
  );
}

interface MockActivityItem {
  id: string;
  title: string;
  agentId: string;
  agentName: string;
  time: string;
  running: boolean;
  unread: boolean;
  slack?: boolean;
  schedule?: boolean;
  channelType: ChannelType;
}

const mockActivity: MockActivityItem[] = [
  {
    id: "act1",
    title: "Fix login redirect loop",
    agentId: "a1",
    agentName: "ci-pipeline",
    time: "2m ago",
    running: true,
    unread: false,
    channelType: "chat",
  },
  {
    id: "act2",
    title: "Audit PR #501 perf regression",
    agentId: "a2",
    agentName: "code-review-bot",
    time: "8m ago",
    running: true,
    unread: false,
    slack: true,
    channelType: "slack",
  },
  {
    id: "act3",
    title: "Triage issue #1204",
    agentId: "a3",
    agentName: "bug-triage",
    time: "3h ago",
    running: false,
    unread: true,
    channelType: "chat",
  },
  {
    id: "act4",
    title: "Update API reference v3",
    agentId: "a4",
    agentName: "api-docs",
    time: "5h ago",
    running: false,
    unread: false,
    channelType: "chat",
  },
  {
    id: "act5",
    title: "Weekly dep audit",
    agentId: "a1",
    agentName: "ci-pipeline",
    time: "1d ago",
    running: false,
    unread: false,
    schedule: true,
    channelType: "schedule",
  },
  {
    id: "act6",
    title: "Deploy canary to staging",
    agentId: "a2",
    agentName: "code-review-bot",
    time: "1d ago",
    running: false,
    unread: false,
    channelType: "terminal",
  },
  {
    id: "act7",
    title: "Slack thread: billing question",
    agentId: "a3",
    agentName: "bug-triage",
    time: "2d ago",
    running: false,
    unread: false,
    slack: true,
    channelType: "slack",
  },
];

const AGENT_SESSION_PAGE = 3;

const stateLabel: Record<AgentState, string> = {
  running: "Working",
  hibernated: "Hibernated",
  hibernating: "Hibernating",
};

const stateDotClass: Record<AgentState, string> = {
  running:
    "border-[1.5px] border-[#198038] bg-[#defbe6] dark:border-[#42be65] dark:bg-[#022d0d]",
  hibernated: "bg-[#4589ff] dark:bg-[#60a5fa]",
  hibernating: "bg-[#878d96] dark:bg-[#a8a29e]",
};

function matchesFilter(
  item: MockActivityItem,
  filter: ActivityFilter,
): boolean {
  if (!filter.channelTypes.has(item.channelType)) return false;
  switch (filter.state) {
    case "any":
      return true;
    case "attention":
      return false;
    case "in-progress":
      return item.running;
    case "unread":
      return item.unread;
  }
}

function ActivityFilterMenu({
  value,
  onChange,
}: {
  value: ActivityFilter;
  onChange: (value: ActivityFilter) => void;
}) {
  const active = isActivityFiltered(value);
  const toggleType = (type: ChannelType) => {
    const next = new Set(value.channelTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    onChange({ ...value, channelTypes: next });
  };
  return (
    <DropdownMenu>
      <Tooltip content="Filter activity" side="right">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={
              active ? "Filter activity, filtered" : "Filter activity"
            }
            className={cn(
              "flex size-6 items-center justify-center rounded-md border border-border transition-colors hover:bg-muted hover:text-foreground",
              active
                ? "bg-muted text-foreground"
                : "bg-background text-muted-foreground",
            )}
          >
            <Filter size={16} />
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        className="max-h-[80vh] w-auto min-w-[360px] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-sm font-medium text-foreground">Filters</span>
          <button
            type="button"
            onClick={() => onChange(defaultActivityFilter())}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Reset to default
          </button>
        </div>
        <DropdownMenuSeparator />
        <div className="flex gap-4 px-2 py-1">
          <div className="min-w-[160px] shrink-0">
            <p className="px-0 py-1.5 text-xs font-medium text-muted-foreground">
              Status
            </p>
            {STATE_FILTERS.map((state) => {
              const selected = value.state === state;
              return (
                <DropdownMenuItem
                  key={state}
                  onSelect={(event) => {
                    event.preventDefault();
                    onChange({ ...value, state });
                  }}
                  className={cn(
                    "flex items-center justify-between gap-3",
                    selected && "bg-muted",
                  )}
                >
                  <span>{STATE_FILTER_LABELS[state]}</span>
                  {selected && (
                    <Checkmark size={16} className="shrink-0 text-foreground" />
                  )}
                </DropdownMenuItem>
              );
            })}
          </div>
          <div className="min-w-0 flex-1">
            <p className="px-0 py-1.5 text-xs font-medium text-muted-foreground">
              Type
            </p>
            {CHANNEL_TYPES.map((type) => (
              <DropdownMenuCheckboxItem
                key={type}
                checked={value.channelTypes.has(type)}
                onCheckedChange={() => toggleType(type)}
                onSelect={(event) => event.preventDefault()}
              >
                {CHANNEL_TYPE_LABELS[type]}
              </DropdownMenuCheckboxItem>
            ))}
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AgentOverflowMenu({ state }: { state: AgentState }) {
  const canStart = state === "hibernated" || state === "hibernating";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          onClick={(e) => e.stopPropagation()}
          aria-label="More actions"
        >
          <OverflowMenuVertical size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canStart ? (
          <DropdownMenuItem>Wake</DropdownMenuItem>
        ) : (
          <DropdownMenuItem>Restart</DropdownMenuItem>
        )}
        {state === "running" && (
          <>
            <DropdownMenuItem>Pause — wakes on next use</DropdownMenuItem>
            <DropdownMenuItem>Stop — until started again</DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem tone="danger">
          <TrashCan size={13} /> Delete agent
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FocusedAgentCard({
  agent,
  onNewChat,
  onClose,
}: {
  agent: MockAgent;
  onNewChat: () => void;
  onClose: () => void;
}) {
  const unreadCount = agent.sessions.filter((s) => s.unread).length;
  return (
    <div className="my-1 rounded-xl bg-background px-3 py-2.5 shadow-sm ring-1 ring-border">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            stateDotClass[agent.state],
          )}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {agent.name}
        </span>
        <Tooltip content="New chat" side="right">
          <button
            type="button"
            onClick={onNewChat}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            aria-label={`New chat with ${agent.name}`}
          >
            <NewTab size={16} />
          </button>
        </Tooltip>
        <AgentOverflowMenu state={agent.state} />
        <span className="mx-0.5 h-4 w-px bg-border" />
        <Tooltip content="Show all activity (Esc)" side="right">
          <button
            type="button"
            onClick={onClose}
            aria-label="Show all activity"
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Close size={16} />
          </button>
        </Tooltip>
      </div>
      <p className="mt-1 pl-4 text-sm text-muted-foreground">
        {stateLabel[agent.state]} · {agent.sessions.length} session
        {agent.sessions.length === 1 ? "" : "s"}
        {unreadCount > 0 && ` · ${unreadCount} unread`}
      </p>
    </div>
  );
}

function NavItem({
  icon: Icon,
  label,
  active,
}: {
  icon: CarbonIconType;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-[34px] w-full items-center gap-3 rounded-lg px-3 transition-colors",
        active
          ? "bg-muted text-primary"
          : "text-foreground/80 hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon size={16} />
      <span className="truncate text-sm font-medium">{label}</span>
    </button>
  );
}

export function ExpandedSidebar({
  activeNav,
}: {
  activeNav?: "home" | "artifacts" | "starter-kits" | "settings";
}) {
  const [expandedAgentIds, setExpandedAgentIds] = useState<Set<string>>(
    () => new Set(["a1"]),
  );
  const [scopedAgentId, setScopedAgentId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>(
    defaultActivityFilter,
  );
  const [showAllAgents, setShowAllAgents] = useState(false);
  const [agentSessionLimits, setAgentSessionLimits] = useState<
    Record<string, number>
  >({});

  const scrollRef = useRef<HTMLDivElement>(null);
  const agentSentinelRef = useRef<HTMLDivElement>(null);
  const activitySentinelRef = useRef<HTMLDivElement>(null);
  const [agentsStuck, setAgentsStuck] = useState(false);
  const [activityStuck, setActivityStuck] = useState(false);

  const toggleAgent = useCallback((id: string) => {
    setExpandedAgentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setAgentSessionLimits((c) => {
          const next = { ...c };
          delete next[id];
          return next;
        });
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const setScope = useCallback((id: string | null) => {
    setScopedAgentId(id);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && scopedAgentId) {
        setScope(null);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [scopedAgentId, setScope]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target === agentSentinelRef.current) {
            setAgentsStuck(!entry.isIntersecting);
          }
          if (entry.target === activitySentinelRef.current) {
            setActivityStuck(!entry.isIntersecting);
          }
        }
      },
      { root, threshold: 0 },
    );

    if (agentSentinelRef.current) observer.observe(agentSentinelRef.current);
    if (activitySentinelRef.current)
      observer.observe(activitySentinelRef.current);

    return () => observer.disconnect();
  }, []);

  const focusing = scopedAgentId !== null;
  const focusIndex = focusing
    ? mockAgents.findIndex((a) => a.id === scopedAgentId)
    : -1;

  const activeAgents = mockAgents.filter((a) => a.state === "running");
  const visibleAgents = showAllAgents ? mockAgents : activeAgents;
  const hasHiddenAgents = activeAgents.length < mockAgents.length;

  const filteredActivity = mockActivity
    .filter((item) => matchesFilter(item, activityFilter))
    .filter((item) => (!scopedAgentId ? true : item.agentId === scopedAgentId));

  return (
    <nav className="flex h-full w-[320px] shrink-0 flex-col border-r border-border bg-card">
      <div className="flex shrink-0 items-center justify-between px-2 pt-2">
        <button
          type="button"
          className="rounded-lg p-1 text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
        >
          <div className="flex size-6 items-center justify-center rounded bg-primary">
            <span className="text-[10px] font-bold text-primary-foreground">
              P
            </span>
          </div>
        </button>
        <button
          type="button"
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft size={16} />
        </button>
      </div>

      <div className="mt-px flex shrink-0 flex-col gap-px px-2">
        <NavItem icon={Home} label="Home" active={activeNav === "home"} />
        <NavItem
          icon={Folders}
          label="Artifacts"
          active={activeNav === "artifacts"}
        />
        <NavItem
          icon={Cube}
          label="Starter Kits"
          active={activeNav === "starter-kits"}
        />
      </div>

      <div
        ref={scrollRef}
        className="mt-6 flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        <div>
          <div ref={agentSentinelRef} className="h-0" />
          <div
            className={cn(
              "sticky top-0 z-10 mb-1.5 flex items-center justify-between bg-card px-5 pb-1 pt-3 transition-[border-color]",
              agentsStuck
                ? "border-b border-[#dde1e6] dark:border-white/10"
                : "border-b border-transparent",
            )}
          >
            <SectionLabel>Agents</SectionLabel>
            <Tooltip content="Create agent" side="right">
              <button
                type="button"
                aria-label="Create agent"
                className="flex size-6 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Add size={16} />
              </button>
            </Tooltip>
          </div>
          <div className="flex flex-col gap-px px-2">
            {visibleAgents.map((agent, agentIndex) => {
              const isExpanded = expandedAgentIds.has(agent.id);
              const sessionLimit =
                agentSessionLimits[agent.id] ?? AGENT_SESSION_PAGE;
              const visibleSessions = agent.sessions.slice(0, sessionLimit);
              const hasMoreSessions = sessionLimit < agent.sessions.length;
              const hasUnread = agent.sessions.some((s) => s.unread);
              const isFocused = focusing && agent.id === scopedAgentId;
              const folded = focusing && !isFocused;
              const isSelected =
                !!activeSessionId &&
                agent.sessions.some((s) => s.id === activeSessionId);

              return (
                <div
                  key={agent.id}
                  inert={folded || undefined}
                  className={cn(
                    "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
                    folded
                      ? "grid-rows-[0fr] opacity-0"
                      : "grid-rows-[1fr] opacity-100",
                  )}
                  style={{
                    transitionDelay: `${Math.min(Math.abs(agentIndex - focusIndex), 6) * 35}ms`,
                  }}
                >
                  <div
                    className={cn(
                      "min-h-0",
                      isFocused ? "overflow-visible" : "overflow-hidden",
                    )}
                  >
                    {isFocused ? (
                      <FocusedAgentCard
                        agent={agent}
                        onNewChat={() => setActiveSessionId(null)}
                        onClose={() => setScope(null)}
                      />
                    ) : (
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleAgent(agent.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggleAgent(agent.id);
                          }
                        }}
                        className={cn(
                          "group/agent relative flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left transition-colors hover:bg-muted cursor-pointer",
                          isSelected && "bg-muted",
                        )}
                      >
                        <AgentAvatar
                          name={agent.name}
                          agentId={agent.id}
                          sleeping={
                            agent.state === "hibernated" ||
                            agent.state === "hibernating"
                          }
                          className="!size-6"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                          {agent.name}
                        </span>
                        {isExpanded ? (
                          <ChevronDown
                            size={16}
                            className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/agent:opacity-100"
                          />
                        ) : (
                          <>
                            {hasUnread && !isSelected && (
                              <span
                                aria-label="Unread sessions"
                                className="absolute top-1/2 right-3 size-2 -translate-y-1/2 rounded-full bg-accent group-hover/agent:invisible group-focus-within/agent:invisible"
                              />
                            )}
                            <ChevronRight
                              size={16}
                              className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/agent:opacity-100"
                            />
                          </>
                        )}
                        <span
                          className={cn(
                            "flex shrink-0 items-center gap-0.5 transition-opacity group-hover/agent:opacity-100 focus-within:opacity-100",
                            isSelected ? "opacity-100" : "opacity-0",
                          )}
                        >
                          <Tooltip content="New chat" side="right">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveSessionId(null);
                              }}
                              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                              aria-label={`New chat with ${agent.name}`}
                            >
                              <NewTab size={16} />
                            </button>
                          </Tooltip>
                          <AgentOverflowMenu state={agent.state} />
                        </span>
                      </div>
                    )}
                    {isExpanded && visibleSessions.length > 0 && (
                      <div className="mt-2 mb-3 flex flex-col gap-1">
                        {visibleSessions.map((session) => (
                          <div
                            key={session.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => setActiveSessionId(session.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setActiveSessionId(session.id);
                              }
                            }}
                            className={cn(
                              "group/agentsession relative flex w-full flex-col gap-0.5 rounded-lg py-2.5 pl-12 pr-8 text-left transition-colors hover:bg-muted cursor-pointer",
                              activeSessionId === session.id && "bg-muted",
                            )}
                          >
                            <span className="flex items-center gap-1.5">
                              <span className="min-w-0 truncate text-sm text-foreground">
                                {session.title}
                              </span>
                              {session.running && (
                                <span className="working-dots ml-auto shrink-0 inline-flex items-center -space-x-[1px] group-hover/agentsession:invisible">
                                  <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
                                  <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
                                  <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
                                </span>
                              )}
                              {session.unread && !session.running && (
                                <span className="ml-auto size-2 shrink-0 rounded-full bg-accent group-hover/agentsession:invisible" />
                              )}
                            </span>
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <span className="min-w-0 truncate">
                                {session.time}
                              </span>
                              {session.slack && (
                                <>
                                  <span>·</span>
                                  <img
                                    src="/icons/slack.svg"
                                    alt="Slack"
                                    className="size-3.5 shrink-0"
                                  />
                                </>
                              )}
                              {session.schedule && (
                                <>
                                  <span>·</span>
                                  <span className="shrink-0 text-muted-foreground">
                                    <Time size={16} />
                                  </span>
                                </>
                              )}
                            </span>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  className="absolute right-3 top-1.5 opacity-0 transition-opacity group-hover/agentsession:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                                  onClick={(e) => e.stopPropagation()}
                                  aria-label="More actions"
                                >
                                  <OverflowMenuVertical size={16} />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem tone="danger">
                                  <TrashCan size={13} /> Delete session
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        ))}
                        {hasMoreSessions && (
                          <button
                            type="button"
                            onClick={() =>
                              setAgentSessionLimits((prev) => ({
                                ...prev,
                                [agent.id]:
                                  (prev[agent.id] ?? AGENT_SESSION_PAGE) +
                                  AGENT_SESSION_PAGE,
                              }))
                            }
                            className="w-full py-1 pl-12 pr-3 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
                          >
                            View more
                          </button>
                        )}
                      </div>
                    )}
                    {isExpanded && visibleSessions.length === 0 && (
                      <p className="mb-3 py-1 pl-12 pr-3 text-sm text-muted-foreground">
                        No sessions yet
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {hasHiddenAgents && (
            <button
              type="button"
              inert={focusing || undefined}
              onClick={() => setShowAllAgents((v) => !v)}
              className={cn(
                "mt-1 block overflow-hidden px-5 text-left text-sm text-muted-foreground transition-all duration-300 hover:text-foreground motion-reduce:transition-none",
                focusing ? "max-h-0 py-0 opacity-0" : "max-h-10 py-1.5",
              )}
            >
              {showAllAgents
                ? "Show less"
                : `See all (${mockAgents.length - activeAgents.length} hibernating)`}
            </button>
          )}
        </div>

        <div className="mt-6 pb-4">
          <div ref={activitySentinelRef} className="h-0" />
          <div
            className={cn(
              "sticky top-0 z-10 mb-1.5 flex items-center justify-between bg-card px-5 pb-1 pt-3 transition-[border-color]",
              activityStuck
                ? "border-b border-[#dde1e6] dark:border-white/10"
                : "border-b border-transparent",
            )}
          >
            <SectionLabel>Activity</SectionLabel>
            <ActivityFilterMenu
              value={activityFilter}
              onChange={(f) => setActivityFilter(f)}
            />
          </div>
          {filteredActivity.length === 0 && (
            <p className="px-5 py-2 text-sm text-muted-foreground">
              No matching activity
            </p>
          )}
          <div className="flex flex-col gap-1 px-2">
            {filteredActivity.map((item) => (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => setActiveSessionId(item.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setActiveSessionId(item.id);
                  }
                }}
                className={cn(
                  "group/activity relative flex w-full flex-col gap-0.5 rounded-lg py-2.5 pl-3 pr-8 text-left transition-colors hover:bg-muted cursor-pointer",
                  activeSessionId === item.id && "bg-muted",
                )}
              >
                <span className="flex items-center gap-1.5">
                  <span className="min-w-0 truncate text-sm text-foreground">
                    {item.title}
                  </span>
                  {item.running && (
                    <span className="working-dots ml-auto shrink-0 inline-flex items-center -space-x-[1px] group-hover/activity:invisible">
                      <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
                      <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
                      <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
                    </span>
                  )}
                  {item.unread && !item.running && (
                    <span className="ml-auto size-2 shrink-0 rounded-full bg-accent group-hover/activity:invisible" />
                  )}
                </span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span className="min-w-0 truncate">
                    {scopedAgentId
                      ? item.time
                      : `${item.agentName} · ${item.time}`}
                  </span>
                  {item.slack && (
                    <>
                      <span>·</span>
                      <Tooltip content="Slack channel" side="right">
                        <img
                          src="/icons/slack.svg"
                          alt="Slack"
                          className="size-3.5 shrink-0"
                        />
                      </Tooltip>
                    </>
                  )}
                  {item.schedule && (
                    <>
                      <span>·</span>
                      <Tooltip content="Scheduled" side="right">
                        <span className="shrink-0 text-muted-foreground">
                          <Time size={16} />
                        </span>
                      </Tooltip>
                    </>
                  )}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="absolute right-3 top-1.5 opacity-0 transition-opacity group-hover/activity:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                      onClick={(e) => e.stopPropagation()}
                      aria-label="More actions"
                    >
                      <OverflowMenuVertical size={16} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem tone="danger">
                      <TrashCan size={13} /> Delete session
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="shrink-0 pb-2 pt-1">
        <div className="flex flex-col gap-px px-2">
          <NavItem icon={Help} label="Documentation" />
          <NavItem
            icon={Settings}
            label="Settings"
            active={activeNav === "settings"}
          />
        </div>
      </div>
    </nav>
  );
}

export const withExpandedSidebar: Decorator = (Story) => (
  <div className="flex h-screen w-full">
    <style>{`[data-testid="app-sidebar"] { display: none !important; }`}</style>
    <ExpandedSidebar />
    <div className="min-w-0 flex-1">
      <Story />
    </div>
  </div>
);
