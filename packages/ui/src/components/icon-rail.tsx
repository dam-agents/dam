import {
  Activity,
  Add,
  Bot,
  type CarbonIconType,
  Checkmark,
  ChevronLeft,
  ChevronRight,
  Cube,
  Filter,
  Folders,
  Help,
  Home,
  NewTab,
  OverflowMenuVertical,
  Reset,
  Settings,
  Time,
  TrashCan,
} from "@carbon/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BrandLogo } from "@/components/brand-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SectionLabel } from "@/components/ui/section-label";
import { Tooltip } from "@/components/ui/tooltip";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";

import { getBrand } from "../brand.js";
import { DOCS_URL } from "../constants.js";
import { externalLinkProps } from "../lib/external-link.js";
import { timeAgo } from "../lib/format-time.js";
import { useAgentsList } from "../modules/agents/api/queries.js";
import {
  AgentAvatar,
  CHAR_NAMES,
  hashIndex,
} from "../modules/agents/components/char-avatar.js";
import { useCharacterUnlocks } from "../modules/agents/lib/character-unlocks.js";
import {
  type AgentDisplayState,
  resolveAgentDisplay,
} from "../modules/agents/utils/agent-resolver.js";
import { useNotifications } from "../modules/notifications/api/queries.js";
import type { NotificationItem } from "../modules/notifications/lib/notification-types.js";
import { isNeedsYou } from "../modules/notifications/lib/notification-types.js";
import { useStore } from "../store.js";
import type { AgentView } from "../types.js";
import { stateDotClass, stateLabel } from "./status-indicator.js";

const SIDEBAR_ACTIVITY_PAGE = 5;
const AGENT_SESSION_PAGE = 5;

interface Destination {
  label: string;
  icon: CarbonIconType;
  active: boolean;
  badge: number;
  navigate: () => void;
  iconClassName?: string;
}

function SidebarAvatar({
  agentId,
  state,
}: {
  agentId: string;
  state: AgentDisplayState;
}) {
  const unlocks = useCharacterUnlocks();
  const charName = CHAR_NAMES[hashIndex(agentId, CHAR_NAMES.length)];
  if (!unlocks.unlocked.has(charName)) {
    return (
      <span
        className={cn("size-2 shrink-0 rounded-full", stateDotClass[state])}
      />
    );
  }
  return (
    <AgentAvatar agentId={agentId} state={state} className="size-5 shrink-0" />
  );
}

export function IconRail({
  hideMobileBar = false,
  agentsOverride,
  showActivity: showActivityProp,
}: {
  hideMobileBar?: boolean;
  agentsOverride?: AgentView[];
  showActivity?: boolean;
} = {}) {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const expandedNav = useStore((s) => s.sidebarExpanded);
  const setExpandedNav = useStore((s) => s.setSidebarExpanded);
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const navigateToAgentLanding = useStore((s) => s.navigateToAgentLanding);
  const openAgentSession = useStore((s) => s.openAgentSession);

  const sandboxes: Destination = {
    label: "Home",
    icon: Home,
    active: view === "home",
    badge: 0,
    navigate: () => setView("home"),
  };
  const starterKits: Destination = {
    label: "Starter Kits",
    icon: Cube,
    active: view === "presets",
    badge: 0,
    navigate: () => setView("presets"),
  };

  const artifacts: Destination = {
    label: "Artifacts",
    icon: Folders,
    active: view === "artifacts",
    badge: 0,
    navigate: () => setView("artifacts"),
  };
  const settings: Destination = {
    label: "Settings",
    icon: Settings,
    active: view === "settings",
    badge: 0,
    navigate: () => navigateToSettings(),
  };

  const storeAgents = useAgentsList();
  const agents = agentsOverride ?? storeAgents;
  const restartingAgents = useStore((s) => s.restartingAgents);
  const pausingAgents = useStore((s) => s.pausingAgents);
  const restartingIds = useMemo(
    () => new Set(restartingAgents.keys()),
    [restartingAgents],
  );
  const pausingIds = useMemo(
    () => new Set(pausingAgents.keys()),
    [pausingAgents],
  );

  const now = useNow(60_000);
  const { items: notifItems, agents: notifAgents } = useNotifications();
  const feedItems = useMemo(
    () => notifItems.filter((i) => !isNeedsYou(i)),
    [notifItems],
  );
  const agentNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of notifAgents) map.set(a.id, a.name);
    return map;
  }, [notifAgents]);

  const [activityCount, setActivityCount] = useState(SIDEBAR_ACTIVITY_PAGE);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>(
    defaultActivityFilter,
  );
  const [showAllAgents, setShowAllAgents] = useState(false);
  const [expandedAgentIds, setExpandedAgentIds] = useState<Set<string>>(
    new Set(),
  );
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [agentSessionCounts, setAgentSessionCounts] = useState<
    Record<string, number>
  >({});

  useEffect(() => {
    if (view !== "chat") setActiveSessionId(null);
  }, [view]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const agentSentinelRef = useRef<HTMLDivElement>(null);
  const activitySentinelRef = useRef<HTMLDivElement>(null);
  const activityEndRef = useRef<HTMLDivElement>(null);
  const hasActivity =
    showActivityProp === false ? false : feedItems.length > 0;
  const hasUnreadActivity = feedItems.some((item) => item.type === "unread");
  const [agentsStuck, setAgentsStuck] = useState(false);
  const [activityStuck, setActivityStuck] = useState(false);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target === agentSentinelRef.current)
            setAgentsStuck(!entry.isIntersecting);
          else if (entry.target === activitySentinelRef.current)
            setActivityStuck(!entry.isIntersecting);
        }
      },
      { root, threshold: 0 },
    );
    if (agentSentinelRef.current) observer.observe(agentSentinelRef.current);
    if (activitySentinelRef.current)
      observer.observe(activitySentinelRef.current);
    return () => observer.disconnect();
  }, [expandedNav, hasActivity]);

  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = activityEndRef.current;
    if (!root || !sentinel || !expandedNav) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setActivityCount((c) => c + SIDEBAR_ACTIVITY_PAGE);
        }
      },
      { root, threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [expandedNav, hasActivity]);

  const activeAgents = useMemo(
    () =>
      agents.filter((a) => {
        const d = resolveAgentDisplay(a, restartingIds, pausingIds);
        return (
          d.state === "running" ||
          d.state === "running_always_on" ||
          d.state === "starting" ||
          d.state === "preparing_workspace" ||
          d.state === "hibernated" ||
          d.state === "idle_always_on"
        );
      }),
    [agents, restartingIds, pausingIds],
  );
  const visibleAgents = useMemo(() => {
    if (!showAllAgents) return activeAgents;
    const isActive = (a: (typeof agents)[number]) => {
      const d = resolveAgentDisplay(a, restartingIds, pausingIds);
      return (
        d.state === "running" ||
        d.state === "running_always_on" ||
        d.state === "starting" ||
        d.state === "preparing_workspace" ||
        d.state === "idle_always_on"
      );
    };
    return [...agents].sort((a, b) => {
      const aActive = isActive(a);
      const bActive = isActive(b);
      if (aActive === bActive) return 0;
      return aActive ? -1 : 1;
    });
  }, [showAllAgents, agents, activeAgents, restartingIds, pausingIds]);
  const hasHiddenAgents = activeAgents.length < agents.length;

  const sessionsByAgent = useMemo(() => {
    const map = new Map<string, NotificationItem[]>();
    for (const item of feedItems) {
      const existing = map.get(item.agentId) ?? [];
      existing.push(item);
      map.set(item.agentId, existing);
    }
    return map;
  }, [feedItems]);

  const globalFilteredFeed = useMemo(
    () =>
      feedItems.filter((item) => matchesActivityFilter(item, activityFilter)),
    [feedItems, activityFilter],
  );
  const visibleActivity = globalFilteredFeed.slice(0, activityCount);
  const hasMoreActivity = activityCount < globalFilteredFeed.length;

  const handleOpen = useCallback(
    (item: NotificationItem) => {
      if (
        item.type === "running" ||
        item.type === "unread" ||
        item.type === "read"
      ) {
        setActiveSessionId(item.session.sessionId);
        setExpandedAgentIds((prev) => new Set(prev).add(item.agentId));
        openAgentSession(item.agentId, item.session.sessionId);
      }
    },
    [openAgentSession],
  );

  return (
    <>
      <nav
        className={cn(
          "hidden md:flex flex-col h-full bg-card border-r border-border shrink-0 transition-[width]",
          expandedNav ? "w-[320px]" : "w-[56px]",
        )}
        data-testid="app-sidebar"
      >
        <div
          className={cn(
            "flex shrink-0 items-center px-2 pt-2",
            expandedNav ? "w-full justify-between gap-2" : "justify-center",
          )}
        >
          {expandedNav && (
            <button
              type="button"
              onClick={sandboxes.navigate}
              aria-label={getBrand().name}
              className="rounded-lg p-1 text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
            >
              <BrandLogo />
            </button>
          )}
          <Tooltip
            content={expandedNav ? "Collapse navigation" : "Expand navigation"}
            side="right"
          >
            <button
              type="button"
              onClick={() => setExpandedNav(!expandedNav)}
              aria-label={
                expandedNav ? "Collapse navigation" : "Expand navigation"
              }
              aria-expanded={expandedNav}
              className={cn(
                "group relative flex items-center justify-center rounded-lg transition-colors hover:bg-muted hover:text-foreground",
                expandedNav
                  ? "p-1.5 text-muted-foreground"
                  : "h-10 w-10 text-foreground/80",
              )}
            >
              {expandedNav ? (
                <ChevronLeft size={16} />
              ) : (
                <>
                  <BrandLogo className="opacity-0 transition-opacity hover-capable:opacity-100 group-hover:opacity-0 group-focus-visible:opacity-0" />
                  <ChevronRight
                    size={16}
                    className="absolute transition-opacity hover-capable:opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                  />
                </>
              )}
            </button>
          </Tooltip>
        </div>
        <div className="mt-px shrink-0 flex flex-col gap-px px-2">
          <RailItem {...sandboxes} expanded={expandedNav} />
          <RailItem {...artifacts} expanded={expandedNav} />
          <RailItem {...starterKits} expanded={expandedNav} />
        </div>

        {expandedNav && (
          <div
            ref={scrollRef}
            className="mt-6 flex min-h-0 flex-1 flex-col overflow-y-auto"
          >
            {agents.length > 0 && (
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
                      onClick={() => setView("agent-new")}
                      aria-label="Create agent"
                      className="flex size-6 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <Add size={16} />
                    </button>
                  </Tooltip>
                </div>
                <div className="flex flex-col gap-px px-2">
                  {visibleAgents.map((agent, agentIndex) => {
                    const display = resolveAgentDisplay(
                      agent,
                      restartingIds,
                      pausingIds,
                    );
                    const isExpanded = expandedAgentIds.has(agent.id);
                    const agentSessions = sessionsByAgent.get(agent.id) ?? [];
                    const sessionLimit =
                      agentSessionCounts[agent.id] ?? AGENT_SESSION_PAGE;
                    const visibleSessions = agentSessions.slice(
                      0,
                      sessionLimit,
                    );
                    const hasMoreSessions = sessionLimit < agentSessions.length;
                    const hasUnread = agentSessions.some(
                      (s) => s.type === "unread",
                    );
                    const isSelected =
                      isExpanded ||
                      (!!activeSessionId &&
                        agentSessions.some(
                          (s) =>
                            (s.type === "running" ||
                              s.type === "unread" ||
                              s.type === "read") &&
                            s.session.sessionId === activeSessionId,
                        ));

                    return (
                      <div key={agent.id}>
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            setExpandedAgentIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(agent.id)) next.delete(agent.id);
                              else next.add(agent.id);
                              return next;
                            });
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setExpandedAgentIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(agent.id)) next.delete(agent.id);
                                else next.add(agent.id);
                                return next;
                              });
                            }
                          }}
                          className={cn(
                            "group group/agent relative flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left transition-colors hover:bg-muted cursor-pointer",
                            isSelected && "bg-muted",
                          )}
                        >
                          <SidebarAvatar
                            agentId={agent.id}
                            state={display.state}
                          />
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                            {agent.name}
                          </span>
                          {hasUnread && !isSelected && (
                            <span
                              aria-label="Unread sessions"
                              className="absolute top-1/2 right-3 size-2 -translate-y-1/2 rounded-full bg-accent group-hover/agent:invisible group-focus-within/agent:invisible"
                            />
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
                                  navigateToAgentLanding(agent.id);
                                }}
                                className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                                aria-label={`New chat with ${agent.name}`}
                              >
                                <NewTab size={16} />
                              </button>
                            </Tooltip>
                            <AgentOverflowMenu display={display} />
                          </span>
                        </div>
                        {isExpanded && visibleSessions.length > 0 && (
                          <div className="mt-1 mb-3 flex flex-col gap-px">
                            {visibleSessions.map((item) => {
                              const isRunning = item.type === "running";
                              const isUnread = item.type === "unread";
                              const hasSession =
                                item.type === "running" ||
                                item.type === "unread" ||
                                item.type === "read";
                              const title = hasSession
                                ? (item.session.title ?? "Session")
                                : "";
                              const meta = item.at ? timeAgo(item.at, now) : "";
                              const isSlack =
                                hasSession && !!item.session.threadTs;
                              const isSchedule =
                                hasSession && !!item.session.scheduleId;
                              return (
                                <div
                                  key={item.id}
                                  role="button"
                                  tabIndex={0}
                                  onClick={
                                    hasSession
                                      ? () => handleOpen(item)
                                      : undefined
                                  }
                                  onKeyDown={(e) => {
                                    if (
                                      hasSession &&
                                      (e.key === "Enter" || e.key === " ")
                                    ) {
                                      e.preventDefault();
                                      handleOpen(item);
                                    }
                                  }}
                                  className={cn(
                                    "group/agentsession relative flex w-full flex-col gap-0.5 rounded-lg py-2 pl-10 pr-3 text-left transition-colors hover:bg-muted cursor-pointer",
                                    hasSession &&
                                      activeSessionId === item.session.sessionId
                                      ? "bg-muted"
                                      : "",
                                  )}
                                >
                                  <span className="flex items-center gap-1.5">
                                    <span className="min-w-0 truncate text-sm text-foreground">
                                      {title}
                                    </span>
                                    {isRunning && (
                                      <span className="working-dots ml-auto shrink-0 inline-flex items-center -space-x-[1px] group-hover/agentsession:invisible">
                                        <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
                                        <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
                                        <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
                                      </span>
                                    )}
                                    {isUnread && !isRunning && (
                                      <span className="ml-auto size-2 shrink-0 rounded-full bg-accent group-hover/agentsession:invisible" />
                                    )}
                                  </span>
                                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <span className="min-w-0 truncate">
                                      {meta}
                                    </span>
                                    {isSlack && (
                                      <>
                                        <span>·</span>
                                        <img
                                          src="/icons/slack.svg"
                                          alt="Slack"
                                          className="size-3.5 shrink-0"
                                        />
                                      </>
                                    )}
                                    {isSchedule && (
                                      <>
                                        <span>·</span>
                                        <span className="shrink-0 text-muted-foreground">
                                          <Time size={14} />
                                        </span>
                                      </>
                                    )}
                                  </span>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon-xs"
                                        className="absolute right-1 top-1.5 opacity-0 transition-opacity group-hover/agentsession:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
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
                              );
                            })}
                            {hasMoreSessions && (
                              <button
                                type="button"
                                onClick={() =>
                                  setAgentSessionCounts((prev) => ({
                                    ...prev,
                                    [agent.id]:
                                      (prev[agent.id] ?? AGENT_SESSION_PAGE) +
                                      AGENT_SESSION_PAGE,
                                  }))
                                }
                                className="w-full py-1 pl-10 pr-3 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
                              >
                                View more
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {hasHiddenAgents && (
                  <button
                    type="button"
                    onClick={() => setShowAllAgents((v) => !v)}
                    className="mt-1 block px-5 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {showAllAgents
                      ? "Show less"
                      : `See all (${agents.length - activeAgents.length} hibernating)`}
                  </button>
                )}
              </div>
            )}

            {hasActivity && (
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
                    onChange={(f) => {
                      setActivityFilter(f);
                      setActivityCount(SIDEBAR_ACTIVITY_PAGE);
                    }}
                  />
                </div>
                {visibleActivity.length === 0 && (
                  <p className="px-5 py-2 text-sm text-muted-foreground">
                    No matching activity
                  </p>
                )}
                <div key="list" className="flex flex-col gap-px px-2">
                  {visibleActivity.map((item, activityIndex) => {
                    const isRunning = item.type === "running";
                    const isUnread = item.type === "unread";
                    const hasSession =
                      item.type === "running" ||
                      item.type === "unread" ||
                      item.type === "read";
                    const title = hasSession
                      ? (item.session.title ?? "Session")
                      : "";
                    const agent = agentNameMap.get(item.agentId) ?? "Agent";
                    const meta = item.at ? timeAgo(item.at, now) : "";
                    const isSlack = hasSession && !!item.session.threadTs;
                    const isSchedule = hasSession && !!item.session.scheduleId;
                    const slackChannel = isSlack
                      ? ((item.session as Record<string, unknown>)
                          .slackChannel as string | undefined)
                      : undefined;
                    return (
                      <div
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        onClick={
                          hasSession ? () => handleOpen(item) : undefined
                        }
                        onKeyDown={(e) => {
                          if (
                            hasSession &&
                            (e.key === "Enter" || e.key === " ")
                          ) {
                            e.preventDefault();
                            handleOpen(item);
                          }
                        }}
                        className={cn(
                          "group/activity relative flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted cursor-pointer",
                          hasSession &&
                            activeSessionId === item.session.sessionId
                            ? "bg-muted"
                            : "",
                        )}
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="min-w-0 truncate text-sm text-foreground">
                            {title}
                          </span>
                          {isRunning && (
                            <span className="working-dots ml-auto shrink-0 inline-flex items-center -space-x-[1px] group-hover/activity:invisible">
                              <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
                              <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
                              <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
                            </span>
                          )}
                          {isUnread && !isRunning && (
                            <span className="ml-auto size-2 shrink-0 rounded-full bg-accent group-hover/activity:invisible" />
                          )}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <span className="min-w-0 truncate">
                            {`${agent}${meta ? ` · ${meta}` : ""}`}
                          </span>
                          {isSlack && (
                            <>
                              <span>·</span>
                              <Tooltip
                                content={
                                  slackChannel
                                    ? `#${slackChannel}`
                                    : "Slack channel"
                                }
                                side="right"
                              >
                                <img
                                  src="/icons/slack.svg"
                                  alt="Slack"
                                  className="size-3.5 shrink-0"
                                />
                              </Tooltip>
                            </>
                          )}
                          {isSchedule && (
                            <>
                              <span>·</span>
                              <Tooltip content="Scheduled" side="right">
                                <span className="shrink-0 text-muted-foreground">
                                  <Time size={14} />
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
                              className="absolute right-2 top-2 opacity-0 transition-opacity group-hover/activity:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
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
                    );
                  })}
                </div>
                {hasMoreActivity && (
                  <div ref={activityEndRef} className="h-px" />
                )}
              </div>
            )}
          </div>
        )}

        {!expandedNav && (
          <>
            {agents.length > 0 && (
              <div className="mt-4 flex flex-col gap-px px-2">
                <Popover>
                  <Tooltip content="Agents" side="right">
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        aria-label="Agents"
                        className="flex h-[34px] w-full items-center justify-center rounded-lg text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <Bot size={16} />
                      </button>
                    </PopoverTrigger>
                  </Tooltip>
                  <PopoverContent
                    side="right"
                    align="start"
                    className="w-[280px] max-h-[400px] overflow-y-auto p-0"
                  >
                    <div className="flex items-center justify-between px-3 pb-1 pt-2.5">
                      <SectionLabel>Agents</SectionLabel>
                      <PopoverClose asChild>
                        <Tooltip content="Create agent" side="right">
                          <button
                            type="button"
                            onClick={() => setView("agent-new")}
                            aria-label="Create agent"
                            className="flex size-6 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            <Add size={16} />
                          </button>
                        </Tooltip>
                      </PopoverClose>
                    </div>
                    <div className="flex flex-col gap-px px-1 pb-2">
                      {visibleAgents.map((agent) => {
                        const display = resolveAgentDisplay(
                          agent,
                          restartingIds,
                          pausingIds,
                        );
                        return (
                          <button
                            key={agent.id}
                            type="button"
                            onClick={() => navigateToAgentLanding(agent.id)}
                            className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted"
                          >
                            <SidebarAvatar
                              agentId={agent.id}
                              state={display.state}
                            />
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                              {agent.name}
                            </span>
                          </button>
                        );
                      })}
                      {hasHiddenAgents && !showAllAgents && (
                        <button
                          type="button"
                          onClick={() => setShowAllAgents(true)}
                          className="px-2 py-1 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
                        >
                          See all ({agents.length - activeAgents.length}{" "}
                          hibernating)
                        </button>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
                <Popover>
                  <Tooltip content="Activity" side="right">
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        aria-label={
                          hasUnreadActivity ? "Activity, unread" : "Activity"
                        }
                        className="relative flex h-[34px] w-full items-center justify-center rounded-lg text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <Activity size={16} />
                        {hasUnreadActivity && (
                          <span className="absolute top-1.5 right-2.5 size-2 rounded-full border-[1.5px] border-card bg-accent" />
                        )}
                      </button>
                    </PopoverTrigger>
                  </Tooltip>
                  <PopoverContent
                    side="right"
                    align="start"
                    className="w-[280px] max-h-[400px] overflow-y-auto p-0"
                  >
                    <div className="flex items-center justify-between px-3 pb-1 pt-2.5">
                      <SectionLabel>Activity</SectionLabel>
                      <ActivityFilterMenu
                        value={activityFilter}
                        onChange={setActivityFilter}
                      />
                    </div>
                    <div className="flex flex-col gap-px px-1 pb-2">
                      {globalFilteredFeed.slice(0, 20).map((item) => {
                        const hasSession =
                          item.type === "running" ||
                          item.type === "unread" ||
                          item.type === "read";
                        const title = hasSession
                          ? (item.session.title ?? "Session")
                          : "";
                        const agentName =
                          agentNameMap.get(item.agentId) ?? "Agent";
                        const isRunning = item.type === "running";
                        const isUnread = item.type === "unread";
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={
                              hasSession ? () => handleOpen(item) : undefined
                            }
                            className="flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted"
                          >
                            <span className="flex items-center gap-1.5">
                              <span className="min-w-0 truncate text-sm text-foreground">
                                {title}
                              </span>
                              {isRunning && (
                                <span className="working-dots ml-auto shrink-0 inline-flex items-center -space-x-[1px]">
                                  <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
                                  <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
                                  <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
                                </span>
                              )}
                              {isUnread && !isRunning && (
                                <span className="ml-auto size-2 shrink-0 rounded-full bg-accent" />
                              )}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {agentName}
                              {item.at ? ` · ${timeAgo(item.at, now)}` : ""}
                            </span>
                          </button>
                        );
                      })}
                      {globalFilteredFeed.length === 0 && (
                        <div className="px-2 py-3 text-center text-sm text-muted-foreground">
                          {feedItems.length === 0
                            ? "No recent activity"
                            : "No matching activity"}
                        </div>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            )}
            <div className="flex-1" />
          </>
        )}

        <div className="shrink-0 pb-2 pt-1">
          <div className="flex flex-col gap-px px-2">
            <RailLink
              label="Documentation"
              icon={Help}
              href={DOCS_URL}
              expanded={expandedNav}
            />
            <RailItem {...settings} expanded={expandedNav} />
          </div>
        </div>
      </nav>

      {!hideMobileBar && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-nav flex items-stretch border-t bg-card/95 backdrop-blur-xl safe-bottom">
          {[sandboxes, artifacts, starterKits].map((destination) => (
            <BottomBarItem key={destination.label} {...destination} />
          ))}
        </nav>
      )}
    </>
  );
}

function RailItem({
  label,
  icon: Icon,
  active,
  badge,
  navigate,
  expanded,
  iconClassName,
}: Destination & { expanded: boolean }) {
  const button = (
    <button
      type="button"
      onClick={navigate}
      aria-label={
        badge > 0 ? `${label}, ${badge} pending` : expanded ? undefined : label
      }
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-[34px] w-full items-center gap-3 rounded-lg px-3 transition-colors",
        iconClassName
          ? cn(
              iconClassName,
              active
                ? "bg-preset-light/50"
                : "bg-preset-light/50 hover:bg-preset-border/30",
            )
          : active
            ? "text-primary bg-muted"
            : "text-foreground/80 hover:text-foreground hover:bg-muted",
      )}
    >
      <IconWithBadge icon={Icon} badge={badge} size={16} />
      {expanded && (
        <span className="truncate text-sm font-medium">{label}</span>
      )}
    </button>
  );
  if (expanded) return button;
  return (
    <Tooltip content={label} side="right">
      {button}
    </Tooltip>
  );
}

function RailLink({
  label,
  icon: Icon,
  href,
  expanded,
}: {
  label: string;
  icon: CarbonIconType;
  href: string;
  expanded: boolean;
}) {
  const link = (
    <a
      href={href}
      {...externalLinkProps}
      className={cn(
        "flex h-[34px] w-full items-center gap-3 rounded-lg px-3 transition-colors",
        "text-foreground/80 hover:text-foreground hover:bg-muted",
      )}
    >
      <Icon size={16} />
      {expanded && (
        <span className="truncate text-sm font-medium">{label}</span>
      )}
    </a>
  );
  if (expanded) return link;
  return (
    <Tooltip content={label} side="right">
      {link}
    </Tooltip>
  );
}

function BottomBarItem({
  label,
  icon: Icon,
  active,
  badge,
  navigate,
  iconClassName,
}: Destination) {
  return (
    <button
      type="button"
      onClick={navigate}
      className={cn(
        "flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors",
        iconClassName ?? (active ? "text-primary" : "text-muted-foreground"),
      )}
    >
      <IconWithBadge icon={Icon} badge={badge} />
      <span className="text-[10px] font-semibold">{label}</span>
    </button>
  );
}

function IconWithBadge({
  icon: Icon,
  badge,
  size = 20,
}: {
  icon: CarbonIconType;
  badge: number;
  size?: number;
}) {
  return (
    <span className="relative flex items-center justify-center">
      <Icon size={size} />
      {badge > 0 && (
        <Badge
          variant="default"
          className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full text-[10px] font-bold flex items-center justify-center border-0 bg-accent text-white hover:bg-accent"
        >
          {badge > 9 ? "9+" : badge}
        </Badge>
      )}
    </span>
  );
}

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

function channelTypeFor(item: NotificationItem): ChannelType {
  if (item.type === "approval-tool" || item.type === "approval-network")
    return "chat";
  if (!("session" in item)) return "chat";
  const { session } = item;
  if (session.scheduleId || session.type === "schedule_cron") return "schedule";
  if (session.mode === "terminal") return "terminal";
  if (session.type === "channel_slack") return "slack";
  if (session.type === "channel_telegram") return "telegram";
  return "chat";
}

function matchesActivityFilter(
  item: NotificationItem,
  filter: ActivityFilter,
): boolean {
  if (!filter.channelTypes.has(channelTypeFor(item))) return false;
  switch (filter.state) {
    case "any":
      return true;
    case "attention":
      return item.type === "approval-tool" || item.type === "approval-network";
    case "in-progress":
      return item.type === "running";
    case "unread":
      return item.type === "unread";
  }
}

const FILTER_GROUP_LABEL =
  "px-3 pt-2 pb-1 text-sm font-medium text-muted-foreground";

function ActivityFilterMenu({
  value,
  onChange,
  agentOptions,
  agentId,
  onAgentChange,
}: {
  value: ActivityFilter;
  onChange: (value: ActivityFilter) => void;
  agentOptions?: { id: string; name: string }[];
  agentId?: string | null;
  onAgentChange?: (id: string | null) => void;
}) {
  const active = isActivityFiltered(value) || !!agentId;
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
        className="max-h-[80vh] w-[400px] overflow-y-auto p-0"
      >
        {agentOptions && onAgentChange && (
          <div className="border-b border-border p-1">
            <p className={FILTER_GROUP_LABEL}>Agent</p>
            {[{ id: null, name: "All agents" }, ...agentOptions].map((a) => (
              <DropdownMenuItem
                key={a.id ?? "all"}
                onSelect={(event) => {
                  event.preventDefault();
                  onAgentChange(a.id);
                }}
              >
                <span className="flex w-4 justify-center">
                  {(agentId ?? null) === a.id && <Checkmark size={16} />}
                </span>
                <span className="truncate">{a.name}</span>
              </DropdownMenuItem>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2">
          <div className="p-1">
            <p className={FILTER_GROUP_LABEL}>Type</p>
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
          <div className="border-l border-border p-1">
            <p className={FILTER_GROUP_LABEL}>Status</p>
            {STATE_FILTERS.map((state) => (
              <DropdownMenuItem
                key={state}
                onSelect={(event) => {
                  event.preventDefault();
                  onChange({ ...value, state });
                }}
              >
                <span className="flex w-4 justify-center">
                  {value.state === state && <Checkmark size={16} />}
                </span>
                {STATE_FILTER_LABELS[state]}
              </DropdownMenuItem>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          <span className="text-sm text-muted-foreground">
            {active ? "Filters on" : "Showing everything"}
          </span>
          <button
            type="button"
            disabled={!active}
            onClick={() => {
              onChange(defaultActivityFilter());
              onAgentChange?.(null);
            }}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-accent transition-colors hover:bg-muted disabled:pointer-events-none disabled:text-muted-foreground/50"
          >
            <Reset size={16} /> Reset to default
          </button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type AgentDisplay = ReturnType<typeof resolveAgentDisplay>;

function AgentOverflowMenu({ display }: { display: AgentDisplay }) {
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
        {display.powerAction === "start" ? (
          <DropdownMenuItem>
            {display.state === "over_budget" ? "Start" : "Wake"}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled={display.powerAction === null}>
            Restart
          </DropdownMenuItem>
        )}
        {display.state === "running" && (
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
