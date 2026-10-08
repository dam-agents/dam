import {
  Activity,
  Add,
  Bot,
  Checkmark,
  ChevronLeft,
  ChevronRight,
  Cube,
  Diagram,
  Filter,
  Help,
  Home,
  NewTab,
  OverflowMenuVertical,
  Reset,
  Settings,
  Time,
  TrashCan,
} from "@carbon/icons-react";
import { useEffect, useRef } from "react";

import { BrandLogo } from "@/components/brand-logo";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import { stateDotClass } from "../components/status-indicator.js";
import type { AgentDisplayState } from "../modules/agents/utils/agent-resolver.js";

const NAV_H = 900;
const EXPANDED_W = 320;
const COLLAPSED_W = 56;

interface SpecAgent {
  id: string;
  name: string;
  state: AgentDisplayState;
  hidden?: boolean;
}

const SPEC_AGENTS: SpecAgent[] = [
  { id: "s1", name: "ci-pipeline", state: "running" },
  { id: "s2", name: "code-review-bot", state: "running" },
  { id: "s3", name: "bug-triage", state: "hibernated" },
  { id: "s4", name: "api-docs", state: "idle_always_on" },
  { id: "s5", name: "pm-standup", state: "hibernating", hidden: true },
  { id: "s6", name: "broken-pipeline", state: "error", hidden: true },
  { id: "s7", name: "cost-runaway", state: "over_budget", hidden: true },
];

interface SpecSession {
  id: string;
  title: string;
  running: boolean;
  unread: boolean;
  agentId: string;
  agentName: string;
  time: string;
  slack?: boolean;
  schedule?: boolean;
}

const SPEC_SESSIONS: SpecSession[] = [
  {
    id: "ms1",
    title: "Design review for checkout flow",
    running: true,
    unread: false,
    agentId: "s1",
    agentName: "ci-pipeline",
    time: "2m ago",
  },
  {
    id: "ms2",
    title: "Sprint planning — mobile team",
    running: false,
    unread: true,
    agentId: "s1",
    agentName: "ci-pipeline",
    time: "30m ago",
  },
  {
    id: "ms3",
    title: "Competitive analysis of onboarding",
    running: false,
    unread: true,
    agentId: "s2",
    agentName: "code-review-bot",
    time: "1h ago",
    slack: true,
  },
  {
    id: "ms4",
    title: "Finalize pricing page copy",
    running: false,
    unread: false,
    agentId: "s2",
    agentName: "code-review-bot",
    time: "3h ago",
  },
  {
    id: "ms5",
    title: "Accessibility audit for dashboard",
    running: false,
    unread: false,
    agentId: "s3",
    agentName: "bug-triage",
    time: "5h ago",
    schedule: true,
  },
  {
    id: "ms6",
    title: "Write PRD for notifications feature",
    running: false,
    unread: false,
    agentId: "s1",
    agentName: "ci-pipeline",
    time: "8h ago",
  },
  {
    id: "ms7",
    title: "Prototype search and filter patterns",
    running: false,
    unread: false,
    agentId: "s4",
    agentName: "api-docs",
    time: "1d ago",
    slack: true,
  },
  {
    id: "ms8",
    title: "Customer journey map — enterprise",
    running: false,
    unread: false,
    agentId: "s2",
    agentName: "code-review-bot",
    time: "2d ago",
  },
  {
    id: "ms9",
    title: "Heuristic evaluation of settings flow",
    running: false,
    unread: false,
    agentId: "s3",
    agentName: "bug-triage",
    time: "3d ago",
  },
  {
    id: "ms10",
    title: "Draft release notes for v3.0 launch",
    running: false,
    unread: false,
    agentId: "s1",
    agentName: "ci-pipeline",
    time: "4d ago",
    schedule: true,
  },
];

const RAIL_NAV_ITEMS = [
  { label: "Home", icon: Home },
  { label: "Artifacts", icon: Diagram },
  { label: "Starter Kits", icon: Cube },
];

const RAIL_BOTTOM_ITEMS = [
  { label: "Documentation", icon: Help },
  { label: "Settings", icon: Settings },
];

const FILTER_TYPES = ["Chat", "Slack", "Telegram", "Schedule", "Terminal"];
const FILTER_STATES = ["All", "Needs attention", "In progress", "Unread"];

const MENU_ITEM = "flex h-9 w-full items-center gap-2 rounded-md px-3 text-sm";
const FLOATING =
  "rounded-md border border-border bg-popover text-popover-foreground shadow-md";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-16 border-t-2 border-foreground/10 pt-8 text-xl font-bold tracking-tight text-foreground first:mt-0 first:border-t-0 first:pt-0">
      {children}
    </h2>
  );
}

function SpecNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 max-w-[880px] text-sm leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}

function RunningDots({
  hidden,
  className,
}: {
  hidden?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "working-dots ml-auto inline-flex shrink-0 items-center -space-x-[1px]",
        hidden && "invisible",
        className,
      )}
    >
      <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
      <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
      <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
    </span>
  );
}

function UnreadDot({
  hidden,
  className,
}: {
  hidden?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "ml-auto size-2 shrink-0 rounded-full bg-accent",
        hidden && "invisible",
        className,
      )}
    />
  );
}

function StaticTooltip({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute z-40 whitespace-nowrap px-3 py-1.5 text-sm",
        FLOATING,
        className,
      )}
    >
      {label}
    </span>
  );
}

function IconBox({
  active,
  children,
}: {
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex size-6 cursor-pointer items-center justify-center rounded-md border border-border hover:bg-muted hover:text-foreground",
        active
          ? "bg-muted text-foreground"
          : "bg-background text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function FilterMenu({ filtered }: { filtered: boolean }) {
  return (
    <div className={cn("w-[400px]", FLOATING)}>
      <div className="grid grid-cols-2">
        <div className="p-1">
          <p className="px-3 pt-2 pb-1 text-sm font-medium text-muted-foreground">
            Type
          </p>
          {FILTER_TYPES.map((t) => (
            <div key={t} className={cn(MENU_ITEM, "relative pl-8")}>
              <span className="absolute left-2 flex size-4 items-center justify-center rounded-sm border border-primary bg-primary text-primary-foreground">
                <Checkmark size={16} />
              </span>
              {t}
            </div>
          ))}
        </div>
        <div className="border-l border-border p-1">
          <p className="px-3 pt-2 pb-1 text-sm font-medium text-muted-foreground">
            Status
          </p>
          {FILTER_STATES.map((st) => {
            const checked = filtered ? st === "Unread" : st === "All";
            return (
              <div key={st} className={cn(MENU_ITEM, checked && "bg-muted")}>
                <span className="flex w-4 justify-center">
                  {checked && <Checkmark size={16} />}
                </span>
                {st}
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-border px-3 py-2">
        <span className="text-sm text-muted-foreground">
          {filtered ? "Filters on" : "Showing everything"}
        </span>
        <span
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2 py-1 text-sm",
            filtered ? "text-accent" : "text-muted-foreground/50",
          )}
        >
          <Reset size={16} /> Reset to default
        </span>
      </div>
    </div>
  );
}

function AgentMenu() {
  return (
    <div className={cn("w-[240px] p-1", FLOATING)}>
      <div className={cn(MENU_ITEM, "bg-muted text-foreground")}>Restart</div>
      <div className={MENU_ITEM}>Pause — wakes on next use</div>
      <div className={MENU_ITEM}>Stop — until started again</div>
      <div className="my-1 h-px bg-border" />
      <div className={cn(MENU_ITEM, "text-danger")}>
        <TrashCan size={16} /> Delete agent
      </div>
    </div>
  );
}

function SessionMeta({
  session,
  withAgent,
}: {
  session: SpecSession;
  withAgent?: boolean;
}) {
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <span className="min-w-0 truncate">
        {withAgent ? `${session.agentName} · ${session.time}` : session.time}
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
          <Time size={16} className="shrink-0" />
        </>
      )}
    </span>
  );
}

function RowOverflow({
  visible,
  className,
}: {
  visible: boolean;
  className: string;
}) {
  return (
    <span
      className={cn(
        "absolute flex size-6 items-center justify-center rounded-md text-muted-foreground group-hover/row:opacity-100 hover:text-foreground",
        visible ? "opacity-100" : "opacity-0",
        className,
      )}
    >
      <OverflowMenuVertical size={16} />
    </span>
  );
}

type AgentHover = "row" | "newChat" | "overflow" | "menu";

export interface ExpandedNavProps {
  showAll?: boolean;
  empty?: boolean;
  expandedAgentId?: string;
  activeSessionId?: string;
  hoverNav?: string;
  hoverAgent?: { id: string; target: AgentHover };
  hoverSessionId?: string;
  hoverActivityId?: string;
  hoverCreate?: boolean;
  filter?: "none" | "filtered" | "open" | "open-filtered";
  scrollTop?: number;
}

export function ExpandedNav({
  showAll,
  empty,
  expandedAgentId,
  activeSessionId,
  hoverNav,
  hoverAgent,
  hoverSessionId,
  hoverActivityId,
  hoverCreate,
  filter = "none",
  scrollTop,
}: ExpandedNavProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current && scrollTop) scrollRef.current.scrollTop = scrollTop;
  }, [scrollTop]);

  const agents = empty
    ? []
    : showAll
      ? SPEC_AGENTS
      : SPEC_AGENTS.filter((a) => !a.hidden);
  const hiddenCount = SPEC_AGENTS.filter((a) => a.hidden).length;
  const sessions = (empty ? [] : SPEC_SESSIONS).map((s) =>
    s.id === activeSessionId ? { ...s, unread: false } : s,
  );
  const filtered = filter === "filtered" || filter === "open-filtered";
  const activity = filtered ? sessions.filter((s) => s.unread) : sessions;
  const stuck = !!scrollTop;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 px-2 pt-2">
        <span className="rounded-lg p-1 text-foreground/80">
          <BrandLogo />
        </span>
        <span className="rounded-lg p-1.5 text-muted-foreground">
          <ChevronLeft size={16} />
        </span>
      </div>
      <div className="mt-px flex shrink-0 flex-col gap-px px-2">
        {RAIL_NAV_ITEMS.map((item) => {
          const active = item.label === "Home";
          const hovered = hoverNav === item.label;
          return (
            <span
              key={item.label}
              className={cn(
                "flex h-[34px] w-full cursor-pointer items-center gap-3 rounded-lg px-3 hover:bg-muted hover:text-foreground",
                active && "bg-muted text-primary",
                !active && hovered && "bg-muted text-foreground",
                !active && !hovered && "text-foreground/80",
              )}
            >
              <item.icon size={16} />
              <span className="truncate text-sm font-medium">{item.label}</span>
            </span>
          );
        })}
      </div>

      <div
        ref={scrollRef}
        className={cn(
          "mt-6 flex min-h-0 flex-1 flex-col",
          scrollTop && "overflow-y-auto",
        )}
      >
        <div>
          <div
            className={cn(
              "sticky top-0 z-10 mb-3 flex items-center justify-between border-b bg-card px-5 pb-2 pt-3",
              stuck
                ? "border-[#dde1e6] dark:border-white/10"
                : "border-transparent",
            )}
          >
            <SectionLabel>Agents</SectionLabel>
            <span className="relative">
              <IconBox active={hoverCreate}>
                <Add size={16} />
              </IconBox>
              {hoverCreate && (
                <StaticTooltip
                  label="Create agent"
                  className="top-1/2 left-full ml-5 -translate-y-1/2"
                />
              )}
            </span>
          </div>
          {agents.length === 0 ? (
            <p className="px-5 py-2 text-sm text-muted-foreground">
              No agents yet
            </p>
          ) : (
            <div className="flex flex-col gap-px px-2">
              {agents.map((agent) => (
                <AgentBlock
                  key={agent.id}
                  agent={agent}
                  sessions={sessions.filter((s) => s.agentId === agent.id)}
                  expanded={expandedAgentId === agent.id}
                  hover={hoverAgent?.id === agent.id ? hoverAgent.target : null}
                  activeSessionId={activeSessionId}
                  hoverSessionId={hoverSessionId}
                />
              ))}
            </div>
          )}
          {!empty && (
            <p className="mt-1 px-5 py-1.5 text-sm text-muted-foreground">
              {showAll ? "Show less" : `See all (${hiddenCount} hibernating)`}
            </p>
          )}
        </div>

        <div className="mt-6 pb-4">
          <div className="sticky top-0 z-10 mb-3 flex items-center justify-between border-b border-transparent bg-card px-5 pb-2 pt-3">
            <SectionLabel>Activity</SectionLabel>
            <span className="relative">
              <IconBox active={filter !== "none"}>
                <Filter size={16} />
              </IconBox>
              {(filter === "open" || filter === "open-filtered") && (
                <span className="absolute -right-24 bottom-full z-30 mb-1">
                  <FilterMenu filtered={filtered} />
                </span>
              )}
            </span>
          </div>
          {activity.length === 0 ? (
            <p className="px-5 py-2 text-sm text-muted-foreground">
              {empty ? "No recent activity" : "No matching activity"}
            </p>
          ) : (
            <div className="flex flex-col gap-px px-2">
              {activity.map((s) => {
                const hovered = hoverActivityId === s.id;
                return (
                  <div
                    key={s.id}
                    className={cn(
                      "group/row relative flex w-full cursor-pointer flex-col gap-0.5 rounded-lg px-3 py-2 hover:bg-muted",
                      (hovered || activeSessionId === s.id) && "bg-muted",
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="min-w-0 truncate text-sm text-foreground">
                        {s.title}
                      </span>
                      {s.running && (
                        <RunningDots
                          hidden={hovered}
                          className="group-hover/row:invisible"
                        />
                      )}
                      {s.unread && !s.running && (
                        <UnreadDot
                          hidden={hovered}
                          className="group-hover/row:invisible"
                        />
                      )}
                    </span>
                    <SessionMeta session={s} withAgent />
                    <RowOverflow visible={hovered} className="top-2 right-2" />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="relative z-20 shrink-0 rounded-bl-lg bg-card pb-2 pt-1">
        <div className="flex flex-col gap-px px-2">
          {RAIL_BOTTOM_ITEMS.map((item) => (
            <span
              key={item.label}
              className={cn(
                "flex h-[34px] w-full cursor-pointer items-center gap-3 rounded-lg px-3 hover:bg-muted hover:text-foreground",
                hoverNav === item.label
                  ? "bg-muted text-foreground"
                  : "text-foreground/80",
              )}
            >
              <item.icon size={16} />
              <span className="truncate text-sm font-medium">{item.label}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function AgentBlock({
  agent,
  sessions,
  expanded,
  hover,
  activeSessionId,
  hoverSessionId,
}: {
  agent: SpecAgent;
  sessions: SpecSession[];
  expanded: boolean;
  hover: AgentHover | null;
  activeSessionId?: string;
  hoverSessionId?: string;
}) {
  const hasUnread = sessions.some((s) => s.unread);
  const selected = expanded || sessions.some((s) => s.id === activeSessionId);
  const showActions = selected || hover !== null;
  return (
    <div>
      <div
        className={cn(
          "group/agent relative flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 hover:bg-muted",
          showActions && "bg-muted",
        )}
      >
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            stateDotClass[agent.state],
          )}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {agent.name}
        </span>
        {hasUnread && !showActions && (
          <span className="absolute top-1/2 right-3 size-2 -translate-y-1/2 rounded-full bg-accent group-hover/agent:invisible" />
        )}
        <span
          className={cn(
            "flex shrink-0 items-center gap-0.5 group-hover/agent:opacity-100",
            showActions ? "opacity-100" : "opacity-0",
          )}
        >
          <span
            className={cn(
              "relative rounded p-0.5 hover:text-foreground",
              hover === "newChat" ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <NewTab size={16} />
            {hover === "newChat" && (
              <StaticTooltip
                label="New chat"
                className="top-1/2 left-full ml-12 -translate-y-1/2"
              />
            )}
          </span>
          <span
            className={cn(
              "relative flex size-6 items-center justify-center rounded-md hover:text-foreground",
              hover === "overflow" || hover === "menu"
                ? "text-foreground"
                : "text-muted-foreground",
            )}
          >
            <OverflowMenuVertical size={16} />
            {hover === "menu" && (
              <span className="absolute top-full right-0 z-30 mt-1">
                <AgentMenu />
              </span>
            )}
          </span>
        </span>
      </div>
      {expanded && sessions.length > 0 && (
        <div className="mt-1 mb-3 flex flex-col gap-px">
          {sessions.map((s) => {
            const hovered = hoverSessionId === s.id;
            return (
              <div
                key={s.id}
                className={cn(
                  "group/row relative flex w-full cursor-pointer flex-col gap-0.5 rounded-lg py-2 pr-3 pl-10 hover:bg-muted",
                  (hovered || activeSessionId === s.id) && "bg-muted",
                )}
              >
                <span className="flex items-center gap-1.5">
                  <span className="min-w-0 truncate text-sm text-foreground">
                    {s.title}
                  </span>
                  {s.running && (
                    <RunningDots
                      hidden={hovered}
                      className="group-hover/row:invisible"
                    />
                  )}
                  {s.unread && !s.running && (
                    <UnreadDot
                      hidden={hovered}
                      className="group-hover/row:invisible"
                    />
                  )}
                </span>
                <SessionMeta session={s} />
                <RowOverflow visible={hovered} className="top-1.5 right-1" />
              </div>
            );
          })}
          <p className="py-1 pr-3 pl-10 text-sm text-muted-foreground">
            View more
          </p>
        </div>
      )}
    </div>
  );
}

export type RailPopover = "agents" | "activity" | "activity-filter" | null;

export function CollapsedNav({
  unreadActivity,
  hoverLogo,
  hoverItem,
  popover = null,
}: {
  unreadActivity?: boolean;
  hoverLogo?: boolean;
  hoverItem?: string;
  popover?: RailPopover;
}) {
  const railButton = (
    label: string,
    Icon: typeof Home,
    opts: {
      active?: boolean;
      open?: boolean;
      dot?: boolean;
      pop?: React.ReactNode;
    },
  ) => {
    const hovered = hoverItem === label;
    return (
      <span
        key={label}
        className={cn(
          "relative flex h-[34px] w-full cursor-pointer items-center justify-center rounded-lg hover:bg-muted hover:text-foreground",
          opts.active && "bg-muted text-primary",
          !opts.active && (hovered || opts.open) && "bg-muted text-foreground",
          !opts.active && !hovered && !opts.open && "text-foreground/80",
        )}
      >
        <Icon size={16} />
        {opts.dot && (
          <span className="absolute top-1.5 right-2.5 size-2 rounded-full border-[1.5px] border-card bg-accent" />
        )}
        {hovered && (
          <StaticTooltip
            label={label}
            className="top-1/2 left-full ml-3 -translate-y-1/2"
          />
        )}
        {opts.pop && (
          <span className="absolute top-0 left-full z-30 ml-3">{opts.pop}</span>
        )}
      </span>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-center px-2 pt-2">
        <span
          className={cn(
            "relative flex h-10 w-10 items-center justify-center rounded-lg text-foreground/80",
            hoverLogo && "bg-muted text-foreground",
          )}
        >
          {hoverLogo ? <ChevronRight size={16} /> : <BrandLogo />}
          {hoverLogo && (
            <StaticTooltip
              label="Expand navigation"
              className="top-1/2 left-full ml-3 -translate-y-1/2"
            />
          )}
        </span>
      </div>
      <div className="mt-px flex shrink-0 flex-col gap-px px-2">
        {RAIL_NAV_ITEMS.map((item) =>
          railButton(item.label, item.icon, { active: item.label === "Home" }),
        )}
      </div>
      <div className="mt-4 flex flex-col gap-px px-2">
        {railButton("Agents", Bot, {
          open: popover === "agents",
          pop: popover === "agents" ? <AgentsPopover /> : undefined,
        })}
        {railButton("Activity", Activity, {
          open: popover === "activity" || popover === "activity-filter",
          dot: unreadActivity,
          pop:
            popover === "activity" || popover === "activity-filter" ? (
              <ActivityPopover filterOpen={popover === "activity-filter"} />
            ) : undefined,
        })}
      </div>
      <div className="flex-1" />
      <div className="shrink-0 pb-2 pt-1">
        <div className="flex flex-col gap-px px-2">
          {RAIL_BOTTOM_ITEMS.map((item) =>
            railButton(item.label, item.icon, {}),
          )}
        </div>
      </div>
    </div>
  );
}

function PopoverShell({
  title,
  action,
  children,
}: {
  title: string;
  action: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="w-[280px] rounded-xl border border-border bg-popover shadow-xl">
      <div className="flex items-center justify-between px-3 pb-1.5 pt-3">
        <SectionLabel>{title}</SectionLabel>
        {action}
      </div>
      <div className="flex flex-col gap-px px-1 pb-2">{children}</div>
    </div>
  );
}

function AgentsPopover() {
  return (
    <PopoverShell
      title="Agents"
      action={
        <IconBox>
          <Add size={16} />
        </IconBox>
      }
    >
      {SPEC_AGENTS.filter((a) => !a.hidden).map((a, i) => (
        <span
          key={a.id}
          className={cn(
            "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted",
            i === 1 && "bg-muted",
          )}
        >
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              stateDotClass[a.state],
            )}
          />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
            {a.name}
          </span>
        </span>
      ))}
      <p className="px-2 py-1 text-left text-sm text-muted-foreground">
        See all ({SPEC_AGENTS.filter((a) => a.hidden).length} hibernating)
      </p>
    </PopoverShell>
  );
}

function ActivityPopover({ filterOpen }: { filterOpen: boolean }) {
  return (
    <PopoverShell
      title="Activity"
      action={
        <span className="relative">
          <IconBox active={filterOpen}>
            <Filter size={16} />
          </IconBox>
          {filterOpen && (
            <span className="absolute top-full -right-[72px] z-40 mt-1">
              <FilterMenu filtered={false} />
            </span>
          )}
        </span>
      }
    >
      {SPEC_SESSIONS.slice(0, 7).map((s, i) => (
        <span
          key={s.id}
          className={cn(
            "flex w-full cursor-pointer flex-col gap-0.5 rounded-lg px-2 py-1.5 hover:bg-muted",
            i === 2 && !filterOpen && "bg-muted",
          )}
        >
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 truncate text-sm text-foreground">
              {s.title}
            </span>
            {s.running && <RunningDots />}
            {s.unread && !s.running && <UnreadDot />}
          </span>
          <SessionMeta session={s} withAgent />
        </span>
      ))}
    </PopoverShell>
  );
}

function PageCanvas() {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 p-8" aria-hidden>
      <div className="h-7 w-2/3 rounded-md bg-muted/60" />
      <div className="h-4 w-full rounded bg-muted/40" />
      <div className="mt-4 h-32 w-full rounded-xl bg-muted/30" />
      <div className="h-20 w-full rounded-xl bg-muted/30" />
      <div className="h-20 w-full rounded-xl bg-muted/30" />
    </div>
  );
}

function Board({
  title,
  notes,
  navWidth,
  canvasWidth,
  children,
}: {
  title: string;
  notes: string[];
  navWidth: number;
  canvasWidth: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col gap-3"
      style={{ width: navWidth + canvasWidth }}
    >
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <div
        className="relative flex overflow-hidden rounded-lg border border-border bg-background"
        style={{ height: NAV_H }}
      >
        <div
          className="relative z-10 h-full shrink-0 rounded-l-lg border-r border-border bg-card"
          style={{ width: navWidth }}
        >
          {children}
        </div>
        {canvasWidth > 0 && <PageCanvas />}
      </div>
      <ul className="flex flex-col gap-1 text-sm leading-relaxed text-muted-foreground">
        {notes.map((n) => (
          <li key={n} className="flex gap-2">
            <span className="text-border">•</span>
            <span>{n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BoardRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 flex flex-wrap items-start gap-12">{children}</div>
  );
}

export function SidebarSpecs() {
  return (
    <div className="pb-20">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">
        Sidebar — Spec Sheet
      </h1>
      <p className="mt-2 max-w-[880px] text-sm leading-relaxed text-muted-foreground">
        Every state of the left navigation, shown in place inside a full-height
        nav (900px). Each board freezes several states at once so they can be
        captured together. Tooltips, popovers and menus open into the page area
        beside the nav, as they do in the app.
      </p>

      <SectionTitle>1. Collapsed navigation</SectionTitle>
      <SpecNote>
        56px wide. Icons 16×16 in 34px rows, px-2. The brand logo swaps to an
        expand chevron on hover. Agents and Activity open popovers (280px wide).
        The Activity icon gets a blue dot when anything is unread.
      </SpecNote>
      <BoardRow>
        <Board
          title="At rest"
          navWidth={COLLAPSED_W}
          canvasWidth={220}
          notes={[
            "Home is the current page",
            "Unread activity: blue dot on the Activity icon",
          ]}
        >
          <CollapsedNav unreadActivity />
        </Board>
        <Board
          title="Hover"
          navWidth={COLLAPSED_W}
          canvasWidth={260}
          notes={[
            "Logo hovered: swaps to the expand chevron, tooltip to the right",
          ]}
        >
          <CollapsedNav unreadActivity hoverLogo />
        </Board>
        <Board
          title="Icon tooltip"
          navWidth={COLLAPSED_W}
          canvasWidth={220}
          notes={["Agents icon hovered: tooltip to the right"]}
        >
          <CollapsedNav unreadActivity hoverItem="Agents" />
        </Board>
        <Board
          title="Agents popover open"
          navWidth={COLLAPSED_W}
          canvasWidth={340}
          notes={[
            "Create agent button across from the title",
            "code-review-bot hovered",
            "See all is left-aligned",
          ]}
        >
          <CollapsedNav unreadActivity popover="agents" />
        </Board>
        <Board
          title="Activity popover open"
          navWidth={COLLAPSED_W}
          canvasWidth={340}
          notes={["Filter button across from the title", "Third row hovered"]}
        >
          <CollapsedNav unreadActivity popover="activity" />
        </Board>
        <Board
          title="Activity filter open"
          navWidth={COLLAPSED_W}
          canvasWidth={380}
          notes={[
            "Type: multi-select, all on by default",
            "Status: single choice, All by default",
          ]}
        >
          <CollapsedNav unreadActivity popover="activity-filter" />
        </Board>
      </BoardRow>

      <SectionTitle>2. Expanded navigation</SectionTitle>
      <SpecNote>
        320px wide. Section labels are sticky and gain a bottom border once the
        list scrolls under them. Agent rows: 8px status dot (60 border, 10
        fill), name text-sm semibold. Hovering or selecting an agent shows New
        chat and the overflow menu; a collapsed agent with unread sessions shows
        a blue dot at the far right until hovered or opened.
      </SpecNote>
      <BoardRow>
        <Board
          title="At rest"
          navWidth={EXPANDED_W}
          canvasWidth={0}
          notes={[
            "ci-pipeline and code-review-bot have unread sessions: blue dot at far right",
            "bug-triage idle (blue), api-docs idle + always on",
            "Activity: running dots, unread dots, Slack and schedule markers",
          ]}
        >
          <ExpandedNav />
        </Board>
        <Board
          title="Selected, expanded, hover"
          navWidth={EXPANDED_W}
          canvasWidth={120}
          notes={[
            "ci-pipeline selected + expanded: bg-muted, buttons stay visible, unread moves to its sessions",
            "Active session: bg-muted; hovered session: overflow shows, dot hides",
            "code-review-bot hovered on New chat: dot hides, tooltip to the right",
            "Artifacts nav item hovered",
          ]}
        >
          <ExpandedNav
            expandedAgentId="s1"
            activeSessionId="ms6"
            hoverSessionId="ms2"
            hoverAgent={{ id: "s2", target: "newChat" }}
            hoverNav="Artifacts"
          />
        </Board>
        <Board
          title="Agent menu open"
          navWidth={EXPANDED_W}
          canvasWidth={0}
          notes={[
            "code-review-bot overflow menu open, Restart highlighted",
            "Activity row hovered: overflow shows, dot hides",
          ]}
        >
          <ExpandedNav
            hoverAgent={{ id: "s2", target: "menu" }}
            hoverActivityId="ms3"
          />
        </Board>
      </BoardRow>
      <BoardRow>
        <Board
          title="All agents, filtered activity"
          navWidth={EXPANDED_W}
          canvasWidth={0}
          notes={[
            "See all opened: hibernating (gray), error (red), over budget (orange); toggle reads Show less",
            "Activity filtered to Unread: filter button stays shaded",
          ]}
        >
          <ExpandedNav showAll filter="filtered" />
        </Board>
        <Board
          title="Activity filter open"
          navWidth={EXPANDED_W}
          canvasWidth={160}
          notes={[
            "Filtered to Unread: Reset to default appears",
            "Not enough room below, so the menu opens upward",
            "Create agent hovered: tooltip",
          ]}
        >
          <ExpandedNav filter="open-filtered" hoverCreate />
        </Board>
        <Board
          title="Scrolled"
          navWidth={EXPANDED_W}
          canvasWidth={0}
          notes={[
            "Agents label stuck with its bottom border",
            "ci-pipeline expanded",
          ]}
        >
          <ExpandedNav expandedAgentId="s1" scrollTop={120} />
        </Board>
        <Board
          title="Empty"
          navWidth={EXPANDED_W}
          canvasWidth={0}
          notes={["No agents and no activity yet"]}
        >
          <ExpandedNav empty />
        </Board>
      </BoardRow>
    </div>
  );
}
