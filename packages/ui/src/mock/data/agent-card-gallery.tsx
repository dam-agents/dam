import { PageHeader } from "@/components/ui/page-header";

import { AgentRow } from "../../modules/agents/components/agent-row.js";
import { resolveAgentDisplay } from "../../modules/agents/utils/agent-resolver.js";
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

export function AgentCardGallery() {
  document.title = "Card Designs";
  return (
    <div>
      <PageHeader
        title="Agent card gallery"
        description="Every state rendered side by side. This page is a design review surface — it does not appear in production."
      />

      <div className="flex flex-col gap-8">
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
