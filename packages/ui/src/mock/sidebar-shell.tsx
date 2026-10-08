import type { CarbonIconType } from "@carbon/icons-react";
import {
  Add,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cube,
  Diagram,
  Help,
  Home,
  OverflowMenuVertical,
  Settings,
  Time,
} from "@carbon/icons-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

interface ShellProps {
  children: ReactNode;
  activeNav?: "home" | "artifacts" | "starter-kits" | "settings";
  maxWidth?: "960" | "1200" | "full";
}

type AgentState = "running" | "hibernated" | "hibernating";

const mockAgents: {
  id: string;
  name: string;
  state: AgentState;
  sessions: {
    id: string;
    title: string;
    running: boolean;
    unread: boolean;
    time: string;
    slack?: string;
  }[];
}[] = [
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

const mockActivity = [
  {
    title: "Fix login redirect loop",
    agent: "ci-pipeline",
    time: "2m ago",
    running: true,
  },
  {
    title: "Audit PR #501 perf regression",
    agent: "code-review-bot",
    time: "8m ago",
    running: true,
    slack: true,
  },
  {
    title: "Triage issue #1204",
    agent: "bug-triage",
    time: "3h ago",
    unread: true,
  },
  {
    title: "Update API reference v3",
    agent: "api-docs",
    time: "5h ago",
  },
  {
    title: "Weekly dep audit",
    agent: "ci-pipeline",
    time: "1d ago",
    schedule: true,
  },
];

const stateDotClass: Record<AgentState, string> = {
  running: "bg-green-700 dark:bg-success",
  hibernated: "bg-[#4589ff] dark:bg-[#60a5fa]",
  hibernating: "bg-[#878d96] dark:bg-[#a8a29e]",
};

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

function SessionRow({
  title,
  running,
  unread,
  time,
  slack,
  active,
}: {
  title: string;
  running: boolean;
  unread: boolean;
  time: string;
  slack?: string;
  active?: boolean;
}) {
  const isRead = !running && !unread;

  return (
    <div
      className={cn(
        "group/session flex w-full gap-3 rounded-xl px-4 py-3 text-left transition-colors cursor-pointer hover:bg-muted/50",
        active && "bg-muted",
        (unread || running) &&
          !active &&
          "bg-[#f4f4f4]/50 dark:bg-white/[0.03]",
      )}
    >
      <div className="relative shrink-0 pt-1">
        {running && (
          <span className="working-dots flex items-center -space-x-[1px]">
            <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
            <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
            <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
          </span>
        )}
        {unread && !running && (
          <span className="size-2.5 rounded-full border-2 border-background bg-accent" />
        )}
        {isRead && <span className="size-2.5" />}
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
            {title}
          </p>
          {slack && (
            <span className="shrink-0 text-muted-foreground/60">#{slack}</span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{time}</p>
      </div>

      <div className="flex shrink-0 items-start pt-0.5 opacity-0 transition-opacity group-hover/session:opacity-100">
        <button
          type="button"
          className="flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
        >
          <OverflowMenuVertical size={14} />
        </button>
      </div>
    </div>
  );
}

function AgentRow({
  agent,
  expandedId,
  onToggle,
}: {
  agent: (typeof mockAgents)[number];
  expandedId: string | null;
  onToggle: (id: string) => void;
}) {
  const expanded = expandedId === agent.id;
  const active = false;

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
          onClick={() => onToggle(agent.id)}
          className="flex shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            stateDotClass[agent.state],
          )}
        />
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground leading-snug hover:text-primary transition-colors cursor-pointer">
          {agent.name}
        </span>
        <div className="shrink-0 opacity-0 transition-opacity group-hover/agent:opacity-100">
          <button
            type="button"
            className="flex size-7 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <OverflowMenuVertical size={16} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="ml-4">
          {agent.sessions.length === 0 && (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">
              No sessions yet
            </p>
          )}
          {agent.sessions.map((s) => (
            <SessionRow
              key={s.id}
              title={s.title}
              running={s.running}
              unread={s.unread}
              time={s.time}
              slack={s.slack}
            />
          ))}
          {agent.sessions.length > 3 && (
            <button
              type="button"
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

function ExpandedSidebar({
  activeNav,
}: {
  activeNav?: ShellProps["activeNav"];
}) {
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>("a1");

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
          icon={Diagram}
          label="Artifacts"
          active={activeNav === "artifacts"}
        />
        <NavItem
          icon={Cube}
          label="Starter Kits"
          active={activeNav === "starter-kits"}
        />
      </div>

      <div className="mt-6 flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div>
          <div className="sticky top-0 z-10 mb-3 flex items-center justify-between bg-card px-5 pb-2 pt-3 border-b border-transparent">
            <SectionLabel>Agents</SectionLabel>
            <button
              type="button"
              className="flex size-6 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Add size={16} />
            </button>
          </div>
          <div className="flex flex-col gap-px px-2">
            {mockAgents.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                expandedId={expandedAgentId}
                onToggle={(id) =>
                  setExpandedAgentId((prev) => (prev === id ? null : id))
                }
              />
            ))}
          </div>
        </div>

        <div className="mt-6 pb-4">
          <SectionLabel className="sticky top-0 z-10 mb-3 block bg-card px-5 pb-2 pt-3 border-b border-transparent">
            Activity
          </SectionLabel>
          <div className="flex flex-col gap-px px-2">
            {mockActivity.map((item) => (
              <div
                key={item.title}
                className="group/activity relative flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted cursor-pointer"
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
                    {item.agent} &middot; {item.time}
                  </span>
                  {item.slack && (
                    <>
                      <span>&middot;</span>
                      <img
                        src="/icons/slack.svg"
                        alt="Slack"
                        className="size-3.5 shrink-0"
                      />
                    </>
                  )}
                  {item.schedule && (
                    <>
                      <span>&middot;</span>
                      <span className="shrink-0 text-muted-foreground">
                        <Time size={14} />
                      </span>
                    </>
                  )}
                </span>
                <button
                  type="button"
                  className="absolute right-2 top-2 flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity group-hover/activity:opacity-100 hover:text-foreground"
                >
                  <OverflowMenuVertical size={16} />
                </button>
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

export function PageShell({
  children,
  activeNav,
  maxWidth = "960",
}: ShellProps) {
  const maxWidthClass = {
    "960": "max-w-[960px]",
    "1200": "max-w-[1200px]",
    full: "",
  }[maxWidth];

  return (
    <div className="flex h-screen bg-background">
      <ExpandedSidebar activeNav={activeNav} />
      <main className="relative flex-1 overflow-y-auto">
        <div
          className={cn(
            "mx-auto w-full px-4 py-6 pb-20 md:px-[5%] md:py-10 md:pb-10",
            maxWidthClass,
          )}
        >
          {children}
        </div>
      </main>
    </div>
  );
}

export function ChatShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <ExpandedSidebar />
      <div className="relative flex flex-1 flex-col min-w-0">{children}</div>
    </div>
  );
}

export function SetupShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen bg-background">
      <ExpandedSidebar />
      <main className="relative flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-4 py-6 pb-20 md:px-[5%] md:py-10 md:pb-10">
          {children}
        </div>
      </main>
    </div>
  );
}
