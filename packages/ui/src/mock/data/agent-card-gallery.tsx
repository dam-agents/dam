import { Time } from "@carbon/icons-react";
import type { ApprovalView } from "api-server-api";
import { useMemo } from "react";

import { PageHeader } from "@/components/ui/page-header";

import { AgentRow } from "../../modules/agents/components/agent-row.js";
import { resolveAgentDisplay } from "../../modules/agents/utils/agent-resolver.js";
import { ComputeWidget } from "../../modules/home/components/compute-widget.js";
import { FeedApprovalCard } from "../../modules/home/components/feed-approval-card.js";
import { FeedCard } from "../../modules/home/components/feed-card.js";
import { SpendWidget } from "../../modules/home/components/spend-widget.js";
import type { AgentView } from "../../types.js";
import { agents } from "./agents.js";
import { schedules } from "./schedules.js";

function agentScheduleCount(agentId: string): number {
  return schedules.filter((s) => s.agentId === agentId && s.enabled).length;
}

interface CardDemoProps {
  title: string;
  note: string;
  agent: AgentView;
  isDemo?: boolean;
  temporaryDraw?: { count: number; cpuMilli: number; memoryMi: number };
}

function CardDemo({
  title,
  note,
  agent,
  isDemo,
  temporaryDraw,
}: CardDemoProps) {
  const display = resolveAgentDisplay(agent, new Set(), new Set());
  const noop = () => {};

  return (
    <div>
      <div className="mb-2">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{note}</p>
      </div>
      <AgentRow
        agent={agent}
        display={display}
        temporaryDraw={temporaryDraw}
        deletePending={false}
        isDemo={isDemo}
        onSelect={noop}
        onConfigure={noop}
        configureLabel="Configure agent"
        onWake={noop}
        onRestart={noop}
        onPause={noop}
        onStop={noop}
        onDelete={noop}
        scheduleCount={agentScheduleCount(agent.id) || undefined}
      />
    </div>
  );
}

const running = agents.find((a) => a.state === "running")!;
const hibernated = agents.find((a) => a.state === "hibernated");
const error = agents.find((a) => a.state === "error");
const overBudget = agents.find((a) => a.overBudget);
const alwaysOn = agents.find(
  (a) => a.hibernationTimeoutMin === 0 && a.state === "running",
);
const alwaysOnIdle = agents.find(
  (a) => a.hibernationTimeoutMin === 0 && a.state !== "running",
);
const bare = agents.find(
  (a) =>
    a.channels.length === 0 &&
    a.contributionFailures.length === 0 &&
    !a.overBudget &&
    a.state === "running" &&
    a.id !== running.id,
);
const withSlack = agents.find((a) =>
  a.channels.some((c) => c.type === "slack"),
);

function SectionHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="border-t border-border pt-6">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function WidgetSection() {
  const runningAgents = useMemo(
    () => agents.filter((a) => a.state === "running"),
    [],
  );
  const workingAgentIds = useMemo(
    () =>
      new Set(
        agents
          .filter((a) => a.state === "running" && a.size?.cpu)
          .map((a) => a.id),
      ),
    [],
  );

  return (
    <div>
      <div className="mb-4">
        <p className="text-sm font-semibold text-foreground">
          Compute + Spend Widgets
        </p>
        <p className="text-sm text-muted-foreground">
          These sit above the agent list on the home page.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ComputeWidget
          runningAgents={runningAgents}
          workingAgentIds={workingAgentIds}
        />
        <SpendWidget />
      </div>
    </div>
  );
}

const noop = () => {};

function mockApproval(overrides: Partial<ApprovalView>): ApprovalView {
  return {
    id: `approval-${Math.random().toString(36).slice(2, 8)}`,
    type: "ext_authz",
    agentId: running.id,
    sessionId: "session-001",
    payload: {
      kind: "ext_authz",
      host: "api.openai.com",
      method: "POST",
      path: "/v1/chat/completions",
    },
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 55 * 60_000).toISOString(),
    resolvedAt: null,
    verdict: null,
    status: "pending",
    ...overrides,
  };
}

function FeedCardSection() {
  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Feed Cards (Session)"
        description="These show sessions in the notification drawer. Hover for dismiss button + open arrow."
      />

      <div className="flex flex-col gap-4">
        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">
            1. In-progress — working dots animate
          </p>
          <FeedCard
            icon={null}
            agentName="Campaign Hero Agent"
            title="Generating spring campaign hero images"
            meta="12 min ago"
            working
            onOpen={noop}
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">
            2. Unread — blue dot, dismiss on hover, open arrow
          </p>
          <FeedCard
            icon={null}
            agentName="Retouching Pipeline"
            title="Product photography batch — 48 images processed"
            meta="30 min ago"
            unread
            onOpen={noop}
            onDismiss={noop}
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">
            3. Scheduled — clock icon instead of dot
          </p>
          <FeedCard
            icon={<Time size={16} className="shrink-0" />}
            agentName="Daily Report Agent"
            title="Generate daily performance dashboard"
            meta="Scheduled 8:00 AM"
            onOpen={noop}
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">
            4. Read session — no indicators, just open arrow
          </p>
          <FeedCard
            icon={null}
            agentName="Packaging Layout Agent"
            title="Cereal box dieline v3 complete"
            meta="2 hours ago"
            onOpen={noop}
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">
            5. With children slot (extensible)
          </p>
          <FeedCard
            icon={null}
            agentName="Brand Guidelines Agent"
            title="Updating color palette documentation"
            meta="5 min ago"
            working
            onOpen={noop}
          >
            <div className="mt-2 flex items-center gap-2 rounded-md border border-border/50 bg-muted/40 px-2.5 py-1.5">
              <span className="font-mono text-sm text-muted-foreground">
                brand-colors-v4.pdf
              </span>
            </div>
          </FeedCard>
        </div>
      </div>
    </div>
  );
}

function FeedApprovalCardSection() {
  const pendingToolApproval = mockApproval({
    id: "gallery-tool-pending",
    type: "acp_native",
    payload: {
      kind: "acp_native",
      toolName: "bash",
      args: { command: "npm run build" },
    },
    status: "pending",
  });

  const pendingNetworkApproval = mockApproval({
    id: "gallery-network-pending",
    type: "ext_authz",
    payload: {
      kind: "ext_authz",
      host: "api.openai.com",
      method: "POST",
      path: "/v1/chat/completions",
    },
    status: "pending",
  });

  const pendingNetworkApproval2 = mockApproval({
    id: "gallery-network-pending-2",
    type: "ext_authz",
    payload: {
      kind: "ext_authz",
      host: "registry.npmjs.org",
      method: "GET",
      path: "/lodash",
    },
    status: "pending",
  });

  const expiredApproval = mockApproval({
    id: "gallery-expired",
    type: "ext_authz",
    payload: {
      kind: "ext_authz",
      host: "api.stripe.com",
      method: "POST",
      path: "/v1/charges",
    },
    status: "expired",
    expiresAt: new Date(Date.now() - 10 * 60_000).toISOString(),
  });

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Feed Cards (Approval)"
        description="These show pending approvals. Allow/Deny buttons + overflow menu with permanent actions."
      />

      <div className="flex flex-col gap-4">
        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">
            1. Tool approval — pending (Allow + overflow menu)
          </p>
          <FeedApprovalCard
            approval={pendingToolApproval}
            agentName="Campaign Hero Agent"
            meta="5 min ago"
            onDismiss={noop}
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">
            2. Network approval — pending (Allow + overflow with host-level
            actions)
          </p>
          <FeedApprovalCard
            approval={pendingNetworkApproval}
            agentName="Retouching Pipeline"
            meta="2 min ago"
            onDismiss={noop}
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">
            3. Network approval — another host
          </p>
          <FeedApprovalCard
            approval={pendingNetworkApproval2}
            agentName="Packaging Layout Agent"
            meta="8 min ago"
            onDismiss={noop}
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">
            4. Resolved — Allowed (green label replaces buttons)
          </p>
          <FeedApprovalCard
            approval={pendingToolApproval}
            agentName="Campaign Hero Agent"
            meta="15 min ago"
            onDismiss={noop}
            resolvedLabel="Allowed"
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">
            5. Resolved — Denied (red label replaces buttons)
          </p>
          <FeedApprovalCard
            approval={pendingNetworkApproval}
            agentName="Retouching Pipeline"
            meta="20 min ago"
            onDismiss={noop}
            resolvedLabel="Denied permanently"
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">
            6. Expired — shows note about original request
          </p>
          <FeedApprovalCard
            approval={expiredApproval}
            agentName="Daily Report Agent"
            meta="1 hour ago"
            onDismiss={noop}
          />
        </div>
      </div>
    </div>
  );
}

export function AgentCardGallery() {
  document.title = "Card Gallery — Design Review";
  return (
    <div>
      <PageHeader
        title="Production card designs"
        description="Every card state from prod rendered side by side. Review each one to decide what stays or changes."
      />

      <div className="flex flex-col gap-8">
        {/* Feed cards first — these are what we're reviewing for the notifications redesign */}
        <FeedCardSection />
        <FeedApprovalCardSection />

        {/* Widgets */}
        <WidgetSection />

        {/* Agent row cards below */}
        <SectionHeader
          title="Agent Row Cards"
          description="These are the agent list items on the home page."
        />

        <CardDemo
          title="1. Running agent"
          note="Standard running state with schedules."
          agent={running}
        />

        {bare && (
          <CardDemo
            title="2. Bare card"
            note="Nothing attached. The metadata row should be absent."
            agent={bare}
          />
        )}

        {withSlack && (
          <CardDemo
            title="3. Slack channels"
            note="Agent with Slack channel badges."
            agent={withSlack}
          />
        )}

        {hibernated && (
          <CardDemo
            title="4. Hibernated"
            note="Common real case: agent is hibernated."
            agent={hibernated}
          />
        )}

        {alwaysOn && (
          <CardDemo
            title="5a. Always-on (working)"
            note="Power icon signals always-on — Working badge."
            agent={alwaysOn}
          />
        )}

        {alwaysOnIdle && (
          <CardDemo
            title="5b. Always-on (idle)"
            note="Power icon signals always-on — Idle badge."
            agent={alwaysOnIdle}
          />
        )}

        {error && (
          <CardDemo
            title="6. Error state"
            note="Error badge, contribution failures if any."
            agent={error}
          />
        )}

        {overBudget && (
          <CardDemo
            title="7. Over budget"
            note="Over budget badge."
            agent={overBudget}
          />
        )}

        <CardDemo
          title="8. Demo agent"
          note="Demo tag shown next to agent name."
          agent={running}
          isDemo
        />

        <CardDemo
          title="9. Temporary agents"
          note="Bottom line showing temporary agents running."
          agent={running}
          temporaryDraw={{ count: 3, cpuMilli: 6000, memoryMi: 6144 }}
        />
      </div>
    </div>
  );
}
