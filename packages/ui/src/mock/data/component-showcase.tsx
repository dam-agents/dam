import { Chat, Code, Document, Time, Warning } from "@carbon/icons-react";
import { SessionType } from "api-server-api";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CARD_SURFACE } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

import { SidebarSessionItem } from "../../components/sidebar-session-item.js";
import { AgentRow } from "../../modules/agents/components/agent-row.js";
import { resolveAgentDisplay } from "../../modules/agents/utils/agent-resolver.js";
import { ComputeWidget } from "../../modules/home/components/compute-widget.js";
import { SpendWidget } from "../../modules/home/components/spend-widget.js";
import { NotificationRow } from "../../modules/notifications/components/notification-row.js";
import type { NotificationItem } from "../../modules/notifications/lib/notification-types.js";
import { SessionRow } from "../../modules/sessions/components/session-row.js";
import type { AgentView } from "../../types.js";

const noop = () => {};
const NO_IDS: ReadonlySet<string> = new Set();

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-6 mt-12 border-t-2 border-foreground/10 pt-8 first:mt-0 first:border-t-0 first:pt-0">
      <h2 className="text-xl font-bold tracking-tight text-foreground">
        {children}
      </h2>
    </div>
  );
}

function StateLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-sm font-medium text-muted-foreground/60">
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Mock data helpers
// ---------------------------------------------------------------------------

function makeAgent(id: string, overrides: Partial<AgentView>): AgentView {
  return {
    id,
    name: "Agent Name",
    templateId: "claude-code",
    templateUpdate: null,
    image: "ghcr.io/anthropics/claude-code:latest",
    hibernationTimeoutMin: 30,
    grantedSecretIds: [],
    grantedConnectionIds: [],
    state: "running",
    stopRequested: false,
    overBudget: false,
    size: { cpu: "2000m", memory: "2Gi" },
    contributionFailures: [],
    channels: [],
    kbTemplateId: null,
    spawnedBy: null,
    features: { liveUpdates: true },
    ...overrides,
  };
}

const agentRunning = makeAgent("sc-running", {
  name: "deploy-orchestrator",
  state: "running",
  size: { cpu: "2000m", memory: "2Gi" },
});

const agentIdle = makeAgent("sc-idle", {
  name: "weekend-reviewer",
  state: "hibernated",
  size: { cpu: "2000m", memory: "2Gi" },
});

const agentHibernating = makeAgent("sc-hibernating", {
  name: "batch-processor",
  state: "hibernating",
  size: { cpu: "4000m", memory: "4Gi" },
});

const agentError = makeAgent("sc-error", {
  name: "broken-pipeline",
  state: "error",
  error: "Pod crashed: OOMKilled after 4Gi spike",
  contributionFailures: [
    { kind: "git-clone", message: "Failed to clone: SSH key expired" },
  ],
});

const agentOverBudget = makeAgent("sc-overbudget", {
  name: "cost-runaway",
  state: "hibernated",
  overBudget: true,
  overBudgetMessage: "Exceeded $200 daily spend limit",
});

const agentWithSlack = makeAgent("sc-slack", {
  name: "code-review-bot",
  state: "running",
  size: { cpu: "2000m", memory: "2Gi" },
  channels: [
    { type: "slack", slackChannelId: "#code-reviews", default: true },
    { type: "slack", slackChannelId: "#incidents" },
  ],
});

const agentWithSchedules = makeAgent("sc-sched", {
  name: "nightly-runner",
  state: "running",
  size: { cpu: "2000m", memory: "2Gi" },
});

const agentAlwaysOn = makeAgent("sc-always-on", {
  name: "background-watcher",
  hibernationTimeoutMin: 0,
  state: "running",
  size: { cpu: "2000m", memory: "2Gi" },
  channels: [{ type: "slack", slackChannelId: "#monitoring" }],
});

const allAgents = [agentRunning, agentIdle, agentWithSlack, agentAlwaysOn];

function AgentRowDemo({
  agent,
  label,
  scheduleCount,
}: {
  agent: AgentView;
  label: string;
  scheduleCount?: number;
}) {
  const display = resolveAgentDisplay(agent, NO_IDS);
  return (
    <div className="mb-4">
      <StateLabel>{label}</StateLabel>
      <AgentRow
        agent={agent}
        display={display}
        deletePending={false}
        onSelect={noop}
        onConfigure={noop}
        configureLabel="Configure agent"
        onWake={noop}
        onRestart={noop}
        onPause={noop}
        onStop={noop}
        onDelete={noop}
        scheduleCount={scheduleCount}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mock sessions for SessionRow
// ---------------------------------------------------------------------------

const now = new Date().toISOString();
const hourAgo = new Date(Date.now() - 3600_000).toISOString();
const dayAgo = new Date(Date.now() - 86400_000).toISOString();

function makeSession(overrides: Record<string, unknown>) {
  return {
    sessionId: "sess-0001",
    agentId: "sc-running",
    type: SessionType.Regular,
    mode: "chat" as const,
    createdAt: dayAgo,
    updatedAt: hourAgo,
    title: "Investigate flaky test in payments module",
    running: false,
    seenAt: now,
    ...overrides,
  } as any;
}

// ---------------------------------------------------------------------------
// Mock notifications for NotificationRow
// ---------------------------------------------------------------------------

function makeNotification(
  type: "running" | "unread" | "read",
  overrides: Record<string, unknown> = {},
): NotificationItem {
  return {
    type,
    id: `notif-${type}-${Math.random().toString(36).slice(2, 8)}`,
    agentId: "sc-running",
    at: hourAgo,
    session: makeSession({
      title: "Review PR #487 session history refactor",
      running: type === "running",
    }),
    ...overrides,
  } as NotificationItem;
}

// ---------------------------------------------------------------------------
// Main showcase component
// ---------------------------------------------------------------------------

export function ComponentShowcase() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-10 pb-20 md:px-[5%]">
      <PageHeader
        title="Component Showcase"
        description="Every home-page component rendered in all visual states. Use Figma capture to pull into your design file."
      />

      {/* ----------------------------------------------------------------- */}
      {/* Badges */}
      {/* ----------------------------------------------------------------- */}
      <SectionTitle>Badge</SectionTitle>
      <div className="flex flex-wrap gap-3">
        <Badge variant="default">Default</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Badge variant="outline">Outline</Badge>
        <Badge variant="success">Working</Badge>
        <Badge variant="warning">Over budget</Badge>
        <Badge variant="danger">Error</Badge>
        <Badge variant="info">Info</Badge>
        <Badge variant="muted">Hibernating</Badge>
        <Badge variant="accent">Accent</Badge>
        <Badge variant="destructive">Destructive</Badge>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <Badge variant="success" size="sm">
          sm / success
        </Badge>
        <Badge variant="warning" size="sm">
          sm / warning
        </Badge>
        <Badge variant="outline" size="sm">
          sm / outline
        </Badge>
      </div>

      {/* Blue badge used for "Idle" in AgentRow */}
      <div className="mt-4 flex flex-wrap gap-3">
        <Badge className="border-transparent bg-blue-50 text-blue-600 hover:bg-blue-50 dark:bg-blue-950 dark:text-blue-400 dark:hover:bg-blue-950">
          Idle
        </Badge>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Buttons */}
      {/* ----------------------------------------------------------------- */}
      <SectionTitle>Button</SectionTitle>
      <div className="flex flex-wrap items-center gap-3">
        <Button>Default</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="link">Link</Button>
        <Button variant="destructive">Destructive</Button>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button size="lg">Large</Button>
        <Button size="default">Default</Button>
        <Button size="sm">Small</Button>
        <Button size="xs">Extra small</Button>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button disabled>Disabled</Button>
        <Button variant="outline" disabled>
          Disabled outline
        </Button>
        <Button variant="outline" tone="danger">
          Danger outline
        </Button>
        <Button variant="ghost" tone="danger">
          Danger ghost
        </Button>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* PageHeader */}
      {/* ----------------------------------------------------------------- */}
      <SectionTitle>PageHeader</SectionTitle>

      <StateLabel>Title only</StateLabel>
      <div className="mb-6 rounded-xl border border-border bg-card p-6">
        <PageHeader title="Agents" />
      </div>

      <StateLabel>With description</StateLabel>
      <div className="mb-6 rounded-xl border border-border bg-card p-6">
        <PageHeader
          title="Home"
          description="Each agent runs in its own isolated environment with your credentials and tools injected."
        />
      </div>

      <StateLabel>With description + actions</StateLabel>
      <div className="mb-6 rounded-xl border border-border bg-card p-6">
        <PageHeader
          title="Home"
          description="Each agent runs in its own isolated environment with your credentials and tools injected. Open one to work with it in chat."
          actions={
            <>
              <Button variant="outline">Browse starter kits</Button>
              <Button>Create agent</Button>
            </>
          }
        />
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* AgentRow */}
      {/* ----------------------------------------------------------------- */}
      <SectionTitle>AgentRow</SectionTitle>

      <AgentRowDemo agent={agentRunning} label="Running" />
      <AgentRowDemo agent={agentIdle} label="Idle / Hibernated" />
      <AgentRowDemo agent={agentHibernating} label="Hibernating" />
      <AgentRowDemo agent={agentError} label="Error" />
      <AgentRowDemo agent={agentOverBudget} label="Over budget" />
      <AgentRowDemo agent={agentWithSlack} label="With Slack channels" />
      <AgentRowDemo
        agent={agentWithSchedules}
        label="With schedules"
        scheduleCount={3}
      />
      <AgentRowDemo agent={agentAlwaysOn} label="Always-on (running)" />

      {/* ----------------------------------------------------------------- */}
      {/* NotificationRow */}
      {/* ----------------------------------------------------------------- */}
      <SectionTitle>NotificationRow</SectionTitle>

      <StateLabel>Running (working dots)</StateLabel>
      <div className="mb-4 rounded-xl border border-border bg-card">
        <NotificationRow
          item={makeNotification("running")}
          agentName="deploy-orchestrator"
          agents={allAgents}
          onOpen={noop}
        />
      </div>

      <StateLabel>Unread (blue dot)</StateLabel>
      <div className="mb-4 rounded-xl border border-border bg-card">
        <NotificationRow
          item={makeNotification("unread")}
          agentName="code-review-bot"
          agents={allAgents}
          onOpen={noop}
        />
      </div>

      <StateLabel>Read</StateLabel>
      <div className="mb-4 rounded-xl border border-border bg-card">
        <NotificationRow
          item={makeNotification("read")}
          agentName="weekend-reviewer"
          agents={allAgents}
          onOpen={noop}
        />
      </div>

      <StateLabel>With artifact attachment</StateLabel>
      <div className="mb-4 rounded-xl border border-border bg-card">
        <NotificationRow
          item={makeNotification("unread", {
            artifactName: "Test Coverage Report",
          })}
          agentName="nightly-runner"
          agents={allAgents}
          onOpen={noop}
          onArtifactClick={noop}
        />
      </div>

      <StateLabel>Dismissible (read)</StateLabel>
      <div className="mb-4 rounded-xl border border-border bg-card">
        <NotificationRow
          item={makeNotification("read")}
          agentName="batch-processor"
          agents={allAgents}
          onOpen={noop}
          onDismiss={noop}
        />
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* SessionRow */}
      {/* ----------------------------------------------------------------- */}
      <SectionTitle>SessionRow</SectionTitle>

      <StateLabel>Running (working dots)</StateLabel>
      <div className="mb-4 max-w-[600px] rounded-xl border border-border bg-card">
        <SessionRow
          session={makeSession({
            sessionId: "sess-run-1",
            title: "Triage and label open issues",
            running: true,
          })}
          active={false}
          working={true}
          needsApproval={false}
          onResume={noop}
          onDelete={noop}
        />
      </div>

      <StateLabel>Unread</StateLabel>
      <div className="mb-4 max-w-[600px] rounded-xl border border-border bg-card">
        <SessionRow
          session={makeSession({
            sessionId: "sess-unread-1",
            title: "Security review for OAuth token handling",
            seenAt: dayAgo,
            updatedAt: hourAgo,
          })}
          active={false}
          working={false}
          needsApproval={false}
          unread={true}
          onResume={noop}
          onDelete={noop}
        />
      </div>

      <StateLabel>Read</StateLabel>
      <div className="mb-4 max-w-[600px] rounded-xl border border-border bg-card">
        <SessionRow
          session={makeSession({
            sessionId: "sess-read-1",
            title: "Build Docker image for v2.4 release candidate",
            seenAt: now,
            updatedAt: hourAgo,
          })}
          active={false}
          working={false}
          needsApproval={false}
          onResume={noop}
          onDelete={noop}
        />
      </div>

      <StateLabel>Active (selected)</StateLabel>
      <div className="mb-4 max-w-[600px] rounded-xl border border-border bg-card">
        <SessionRow
          session={makeSession({
            sessionId: "sess-active-1",
            title: "Investigate flaky test in payments module",
          })}
          active={true}
          working={false}
          needsApproval={false}
          onResume={noop}
          onDelete={noop}
        />
      </div>

      <StateLabel>Draft</StateLabel>
      <div className="mb-4 max-w-[600px] rounded-xl border border-border bg-card">
        <SessionRow
          session={makeSession({
            sessionId: "sess-draft-1",
            title: "Untitled session draft",
            seenAt: now,
            updatedAt: hourAgo,
          })}
          active={false}
          working={false}
          needsApproval={false}
          draft={true}
          onResume={noop}
          onDelete={noop}
        />
      </div>

      <StateLabel>Needs approval</StateLabel>
      <div className="mb-4 max-w-[600px] rounded-xl border border-border bg-card">
        <SessionRow
          session={makeSession({
            sessionId: "sess-approval-1",
            title: "Wants to access network",
          })}
          active={false}
          working={false}
          needsApproval={true}
          onResume={noop}
          onDelete={noop}
        />
      </div>

      <StateLabel>Slack channel session</StateLabel>
      <div className="mb-4 max-w-[600px] rounded-xl border border-border bg-card">
        <SessionRow
          session={makeSession({
            sessionId: "sess-slack-1",
            title: "Thread in #code-reviews",
            type: SessionType.ChannelSlack,
            threadTs: "1725800001.0001",
            slackChannel: "code-reviews",
          })}
          active={false}
          working={false}
          needsApproval={false}
          onResume={noop}
          onDelete={noop}
        />
      </div>

      <StateLabel>Scheduled session</StateLabel>
      <div className="mb-4 max-w-[600px] rounded-xl border border-border bg-card">
        <SessionRow
          session={makeSession({
            sessionId: "sess-sched-1",
            title: "Nightly e2e test suite",
            type: SessionType.ScheduleCron,
            scheduleId: "sched-001",
          })}
          active={false}
          working={false}
          needsApproval={false}
          onResume={noop}
          onDelete={noop}
        />
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* SidebarSessionItem */}
      {/* ----------------------------------------------------------------- */}
      <SectionTitle>SidebarSessionItem</SectionTitle>
      <div className="max-w-[280px] rounded-xl border border-border bg-card">
        <div className="py-2">
          <StateLabel>
            <span className="px-4">Running</span>
          </StateLabel>
          <SidebarSessionItem
            agentId="sc-running"
            sessionId="ss-running"
            title="Triage open issues"
            running={true}
            updatedAt={hourAgo}
            seenAt={dayAgo}
            slackChannel={null}
            scheduleId={null}
            threadTs={null}
            onDelete={noop}
          />
        </div>
        <div className="py-2">
          <StateLabel>
            <span className="px-4">Unread</span>
          </StateLabel>
          <SidebarSessionItem
            agentId="sc-running"
            sessionId="ss-unread"
            title="Security review OAuth"
            running={false}
            updatedAt={hourAgo}
            seenAt={dayAgo}
            slackChannel={null}
            scheduleId={null}
            threadTs={null}
            onDelete={noop}
          />
        </div>
        <div className="py-2">
          <StateLabel>
            <span className="px-4">Read</span>
          </StateLabel>
          <SidebarSessionItem
            agentId="sc-running"
            sessionId="ss-read"
            title="Build Docker image v2.4"
            running={false}
            updatedAt={dayAgo}
            seenAt={now}
            slackChannel={null}
            scheduleId={null}
            threadTs={null}
            onDelete={noop}
          />
        </div>
        <div className="py-2">
          <StateLabel>
            <span className="px-4">With Slack channel</span>
          </StateLabel>
          <SidebarSessionItem
            agentId="sc-running"
            sessionId="ss-slack"
            title="Thread in channel"
            running={false}
            updatedAt={hourAgo}
            seenAt={now}
            slackChannel="code-reviews"
            scheduleId={null}
            threadTs="17258.0001"
            onDelete={noop}
          />
        </div>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* ApprovalBanner */}
      {/* ----------------------------------------------------------------- */}
      <SectionTitle>ApprovalBanner</SectionTitle>

      <StateLabel>Single approval</StateLabel>
      <div className="mb-4 max-w-[800px]">
        <ApprovalBannerStatic count={1} />
      </div>

      <StateLabel>Multiple approvals</StateLabel>
      <div className="mb-4 max-w-[800px]">
        <ApprovalBannerStatic count={5} />
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* ComputeWidget + SpendWidget */}
      {/* ----------------------------------------------------------------- */}
      <SectionTitle>Dashboard Widgets</SectionTitle>
      <p className="mb-4 text-sm text-muted-foreground">
        These use live mock API data — they render the same as the home page.
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ComputeWidget
          runningAgents={[agentRunning, agentWithSlack]}
          workingAgentIds={new Set(["sc-running"])}
        />
        <SpendWidget />
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Welcome blocks (HomeEmptyState cards) */}
      {/* ----------------------------------------------------------------- */}
      <SectionTitle>Welcome Cards (Empty State)</SectionTitle>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {WELCOME_BLOCKS.map((block) => {
          const Icon = block.icon;
          return (
            <div
              key={block.title}
              className={cn(CARD_SURFACE, "flex flex-col overflow-hidden")}
            >
              <div className="flex h-36 w-full items-center justify-center bg-muted/50">
                <Icon size={32} className="text-muted-foreground/40" />
              </div>
              <div className="flex flex-1 flex-col p-5">
                <h3 className="text-base font-semibold text-foreground">
                  {block.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {block.body}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Static ApprovalBanner — no store dependency
// ---------------------------------------------------------------------------

function ApprovalBannerStatic({ count }: { count: number }) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-left transition-colors hover:bg-warning/10 dark:border-warning/20 dark:bg-warning/10 dark:hover:bg-warning/15"
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-warning/15 dark:bg-warning/20">
        <Warning size={16} className="text-warning" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">
          {count} {count === 1 ? "approval" : "approvals"} waiting
        </p>
        <p className="text-sm text-muted-foreground">
          {count === 1
            ? "An agent needs your decision"
            : `${count} agents need your decision`}
        </p>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Welcome blocks data (duplicated from HomeView to avoid coupling)
// ---------------------------------------------------------------------------

const WELCOME_BLOCKS = [
  {
    icon: Code,
    title: "Agents",
    body: "An agent is yours to keep. It has its own files, tools, and memory. You chat with it, and it keeps working after you close the tab.",
  },
  {
    icon: Time,
    title: "Schedules",
    body: "An agent can work every morning, every Monday, or whenever you need. Tell it when and what, and it writes its own schedule.",
  },
  {
    icon: Chat,
    title: "Channels",
    body: "Bind an agent to a Slack channel and your team can talk to it there. Or connect your editor over SSH and work in its environment directly.",
  },
  {
    icon: Document,
    title: "Wikis",
    body: "Point an agent at a repo or docs and it writes them up as a wiki, keeps it current, and answers questions from it.",
  },
];
