import {
  Activity,
  Add,
  Bot,
  type CarbonIconType,
  Checkmark,
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
import {
  AgentClickVariantPicker,
  useAgentClickVariant,
} from "../mock/agent-click-variants.js";
import { useAgentsList } from "../modules/agents/api/queries.js";
import { AgentAvatar } from "../modules/agents/components/char-avatar.js";
import { resolveAgentDisplay } from "../modules/agents/utils/agent-resolver.js";
import { useNotifications } from "../modules/notifications/api/queries.js";
import type { NotificationItem } from "../modules/notifications/lib/notification-types.js";
import { isNeedsYou } from "../modules/notifications/lib/notification-types.js";
import { useStore } from "../store.js";
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

export function IconRail({
  hideMobileBar = false,
}: {
  hideMobileBar?: boolean;
} = {}) {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const expandedNav = useStore((s) => s.sidebarExpanded);
  const setExpandedNav = useStore((s) => s.setSidebarExpanded);
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const selectAgent = useStore((s) => s.selectAgent);
  const openAgentSession = useStore((s) => s.openAgentSession);
  const selectedAgent = useStore((s) => s.selectedAgent);

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

  const agents = useAgentsList();
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
  const expandedAgentIds = useStore((s) => s.expandedSidebarAgents);
  const toggleSidebarAgent = useStore((s) => s.toggleSidebarAgent);
  const expandSidebarAgent = useStore((s) => s.expandSidebarAgent);
  const activeSessionId = useStore((s) => s.sidebarActiveSessionId);
  const setSidebarActiveSession = useStore((s) => s.setSidebarActiveSession);
  const [scopedAgentId, setScopedAgentId] = useState<string | null>(null);
  const clickVariant = useAgentClickVariant((s) => s.variant);
  const scopedAgent = scopedAgentId
    ? (agents.find((a) => a.id === scopedAgentId) ?? null)
    : null;
  const setScope = (id: string | null) => {
    setScopedAgentId(id);
    setActivityCount(SIDEBAR_ACTIVITY_PAGE);
  };
  const [agentSessionCounts, setAgentSessionCounts] = useState<
    Record<string, number>
  >({});
  useEffect(() => {
    setScopedAgentId(null);
    useStore.setState({ expandedSidebarAgents: new Set() });
  }, [clickVariant]);
  useEffect(() => {
    const newId = (window as any).__lastMockSessionId as string | undefined;
    if (!newId || !selectedAgent || view !== "chat") return;
    delete (window as any).__lastMockSessionId;
    setSidebarActiveSession(newId);
    expandSidebarAgent(selectedAgent);
  }, [selectedAgent, view, setSidebarActiveSession, expandSidebarAgent]);
  const focusing = clickVariant === 3 && !!scopedAgent;
  useEffect(() => {
    if (!focusing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, [contenteditable=true], [role=menu]"))
        return;
      setScopedAgentId(null);
      setActivityCount(SIDEBAR_ACTIVITY_PAGE);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusing]);

  useEffect(() => {
    if (view !== "chat") setSidebarActiveSession(null);
  }, [view, setSidebarActiveSession]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const agentSentinelRef = useRef<HTMLDivElement>(null);
  const activitySentinelRef = useRef<HTMLDivElement>(null);
  const activityEndRef = useRef<HTMLDivElement>(null);
  const hasActivity = feedItems.length > 0;
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
  const visibleAgents = showAllAgents ? agents : activeAgents;
  const focusIndex = Math.max(
    0,
    visibleAgents.findIndex((a) => a.id === scopedAgentId),
  );
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
    () => feedItems.filter((item) => matchesActivityFilter(item, activityFilter)),
    [feedItems, activityFilter],
  );
  const filteredFeed = useMemo(
    () =>
      scopedAgentId
        ? globalFilteredFeed.filter((item) => item.agentId === scopedAgentId)
        : globalFilteredFeed,
    [globalFilteredFeed, scopedAgentId],
  );
  const visibleActivity = filteredFeed.slice(0, activityCount);
  const hasMoreActivity = activityCount < filteredFeed.length;

  const handleOpen = useCallback(
    (item: NotificationItem, { expandAgent = false } = {}) => {
      if (
        item.type === "running" ||
        item.type === "unread" ||
        item.type === "read"
      ) {
        setSidebarActiveSession(item.session.sessionId);
        if (expandAgent) {
          expandSidebarAgent(item.agentId);
        }
        openAgentSession(item.agentId, item.session.sessionId);
      }
    },
    [openAgentSession, setSidebarActiveSession, expandSidebarAgent],
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
                    const isFocused = focusing && agent.id === scopedAgentId;
                    const folded = focusing && !isFocused;
                    const isSelected =
                      !!activeSessionId &&
                        agentSessions.some(
                          (s) =>
                            (s.type === "running" ||
                              s.type === "unread" ||
                              s.type === "read") &&
                            s.session.sessionId === activeSessionId,
                        );

                    return (
                      <div
                        key={agent.id}
                        inert={folded}
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
                            name={agent.name}
                            display={display}
                            sessionCount={agentSessions.length}
                            unreadCount={
                              agentSessions.filter((x) => x.type === "unread")
                                .length
                            }
                            onNewChat={() => selectAgent(agent.id)}
                            onClose={() => setScope(null)}
                          />
                        ) : (
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            if (clickVariant === 0) {
                              if (expandedAgentIds.has(agent.id)) {
                                setAgentSessionCounts((c) => {
                                  const { [agent.id]: _, ...rest } = c;
                                  return rest;
                                });
                              }
                              toggleSidebarAgent(agent.id);
                            } else {
                              setScope(
                                scopedAgentId === agent.id ? null : agent.id,
                              );
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              if (clickVariant === 0) {
                                if (expandedAgentIds.has(agent.id)) {
                                  setAgentSessionCounts((c) => {
                                    const { [agent.id]: _, ...rest } = c;
                                    return rest;
                                  });
                                }
                                toggleSidebarAgent(agent.id);
                              } else {
                                setScope(
                                  scopedAgentId === agent.id ? null : agent.id,
                                );
                              }
                            }
                          }}
                          className={cn(
                            "group/agent relative flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left transition-colors hover:bg-muted cursor-pointer",
                            isSelected && "bg-muted",
                          )}
                        >
                          <AgentAvatar
                            agentId={agent.id}
                            state={display.state}
                            className="!size-6"
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
                                  selectAgent(agent.id);
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
                        )}
                        {isExpanded &&
                          clickVariant === 0 &&
                          visibleSessions.length > 0 && (
                          <div className="mt-2 mb-3 flex flex-col gap-1">
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
                                      ? () =>
                                          handleOpen(item, {
                                            expandAgent: true,
                                          })
                                      : undefined
                                  }
                                  onKeyDown={(e) => {
                                    if (
                                      hasSession &&
                                      (e.key === "Enter" || e.key === " ")
                                    ) {
                                      e.preventDefault();
                                      handleOpen(item, { expandAgent: true });
                                    }
                                  }}
                                  className={cn(
                                    "group/agentsession relative flex w-full flex-col gap-0.5 rounded-lg py-2.5 pl-12 pr-8 text-left transition-colors hover:bg-muted cursor-pointer",
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
                                className="w-full py-1 pl-12 pr-3 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
                              >
                                View more
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      </div>
                    );
                  })}
                </div>
                {hasHiddenAgents && (
                  <button
                    type="button"
                    inert={focusing}
                    onClick={() => setShowAllAgents((v) => !v)}
                    className={cn(
                      "mt-1 block overflow-hidden px-5 text-left text-sm text-muted-foreground transition-all duration-300 hover:text-foreground motion-reduce:transition-none",
                      focusing ? "max-h-0 py-0 opacity-0" : "max-h-10 py-1.5",
                    )}
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
                  {clickVariant === 1 && scopedAgent ? (
                    <button
                      type="button"
                      onClick={() => setScope(null)}
                      aria-label="Back to all activity"
                      className="-ml-1.5 flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors hover:bg-muted"
                    >
                      <ChevronLeft
                        size={16}
                        className="shrink-0 text-muted-foreground"
                      />
                      <SectionLabel className="truncate">
                        {scopedAgent.name}
                      </SectionLabel>
                    </button>
                  ) : clickVariant === 3 ? (
                    <SectionLabel
                      key={scopedAgentId ?? "all"}
                      className="anim-nav-label-in truncate"
                    >
                      {scopedAgent ? `${scopedAgent.name} activity` : "Activity"}
                    </SectionLabel>
                  ) : (
                    <SectionLabel>Activity</SectionLabel>
                  )}
                  <ActivityFilterMenu
                    value={activityFilter}
                    onChange={(f) => {
                      setActivityFilter(f);
                      setActivityCount(SIDEBAR_ACTIVITY_PAGE);
                    }}
                    {...(clickVariant === 4
                      ? {
                          agentOptions: agents.map((a) => ({
                            id: a.id,
                            name: a.name,
                          })),
                          agentId: scopedAgentId,
                          onAgentChange: setScope,
                        }
                      : {})}
                  />
                </div>
                {clickVariant === 2 && scopedAgent && (
                  <div className="-mt-1 mb-3 px-5">
                    <span className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-border bg-background pr-1 pl-2.5 text-sm text-foreground">
                      <span className="min-w-0 truncate">{scopedAgent.name}</span>
                      <button
                        type="button"
                        onClick={() => setScope(null)}
                        aria-label="Show all activity"
                        className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <Close size={16} />
                      </button>
                    </span>
                  </div>
                )}
                {clickVariant === 4 && scopedAgent && (
                  <p className="-mt-1 mb-3 flex items-center gap-1.5 px-5 text-sm text-muted-foreground">
                    <span className="min-w-0 truncate">
                      Showing {scopedAgent.name}
                    </span>
                    <span>·</span>
                    <button
                      type="button"
                      onClick={() => setScope(null)}
                      className="shrink-0 text-accent hover:text-accent/80"
                    >
                      Show all
                    </button>
                  </p>
                )}
                {clickVariant === 5 && (
                  <div className="-mt-1 mb-3 px-5">
                    <div className="flex rounded-full bg-muted p-1">
                      <button
                        type="button"
                        onClick={() => setScope(null)}
                        className={cn(
                          "h-7 shrink-0 rounded-full px-3 text-sm font-medium transition-colors",
                          !scopedAgent
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        All
                      </button>
                      <span
                        className={cn(
                          "flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded-full px-3 text-sm font-medium",
                          scopedAgent
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground",
                        )}
                      >
                        <span className="truncate">
                          {scopedAgent ? scopedAgent.name : "Pick an agent above"}
                        </span>
                      </span>
                    </div>
                  </div>
                )}
                {visibleActivity.length === 0 && (
                  <p className="px-5 py-2 text-sm text-muted-foreground">
                    No matching activity
                  </p>
                )}
                <div
                  key={clickVariant === 3 ? (scopedAgentId ?? "all") : "list"}
                  className="flex flex-col gap-1 px-2"
                >
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
                          "group/activity relative flex w-full flex-col gap-0.5 rounded-lg py-2.5 pl-3 pr-8 text-left transition-colors hover:bg-muted cursor-pointer",
                          hasSession &&
                            activeSessionId === item.session.sessionId
                            ? "bg-muted"
                            : "",
                          clickVariant === 3 && "anim-nav-row-in",
                        )}
                        style={
                          clickVariant === 3
                            ? {
                                animationDelay: `${120 + Math.min(activityIndex, 10) * 35}ms`,
                              }
                            : undefined
                        }
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
                            {scopedAgentId
                              ? meta
                              : `${agent}${meta ? ` · ${meta}` : ""}`}
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
                            onClick={() => selectAgent(agent.id)}
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted"
                          >
                            <Tooltip content={stateLabel[display.state]} side="right">
                              <span className="shrink-0">
                                <AgentAvatar
                                  agentId={agent.id}
                                  state={display.state}
                                  className="!size-6"
                                />
                              </span>
                            </Tooltip>
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
            aria-label={active ? "Filter activity, filtered" : "Filter activity"}
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
        className="max-h-[80vh] w-auto min-w-[320px] overflow-y-auto"
      >
        {active && (
          <>
            <DropdownMenuItem
              onSelect={() => {
                onChange(defaultActivityFilter());
                onAgentChange?.(null);
              }}
              className="text-muted-foreground"
            >
              <Reset size={16} /> Reset to default
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {agentOptions && onAgentChange && (
          <>
            <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Agent</p>
            {[{ id: null, name: "All agents" }, ...agentOptions].map((a) => (
              <DropdownMenuItem
                key={a.id ?? "all"}
                onSelect={(event) => {
                  event.preventDefault();
                  onAgentChange(a.id);
                }}
              >
                <span className="flex w-4 shrink-0 justify-center">
                  {(agentId ?? null) === a.id && <Checkmark size={16} />}
                </span>
                <span className="truncate">{a.name}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}
        <div className="flex gap-4 px-2 py-1">
          <div className="flex-1 min-w-0">
            <p className="px-0 py-1.5 text-xs font-medium text-muted-foreground">Status</p>
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
          <div className="flex-1 min-w-0">
            <p className="px-0 py-1.5 text-xs font-medium text-muted-foreground">Type</p>
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
              {display.state === "over_budget"
                ? "Start"
                : "Wake"}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              disabled={display.powerAction === null}
            >
              Restart
            </DropdownMenuItem>
          )}
          {display.state === "running" && (
            <>
              <DropdownMenuItem>
                Pause — wakes on next use
              </DropdownMenuItem>
              <DropdownMenuItem>
                Stop — until started again
              </DropdownMenuItem>
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
  name,
  display,
  sessionCount,
  unreadCount,
  onNewChat,
  onClose,
}: {
  name: string;
  display: AgentDisplay;
  sessionCount: number;
  unreadCount: number;
  onNewChat: () => void;
  onClose: () => void;
}) {
  return (
    <div className="anim-nav-focus-in my-1 rounded-xl bg-background px-3 py-2.5 shadow-sm ring-1 ring-border">
      <div className="flex items-center gap-2">
        <span
          className={cn("size-2 shrink-0 rounded-full", stateDotClass[display.state])}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {name}
        </span>
        <Tooltip content="New chat" side="right">
          <button
            type="button"
            onClick={onNewChat}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            aria-label={`New chat with ${name}`}
          >
            <NewTab size={16} />
          </button>
        </Tooltip>
        <AgentOverflowMenu display={display} />
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
        {stateLabel[display.state]} · {sessionCount} session
        {sessionCount === 1 ? "" : "s"}
        {unreadCount > 0 && ` · ${unreadCount} unread`}
      </p>
    </div>
  );
}
