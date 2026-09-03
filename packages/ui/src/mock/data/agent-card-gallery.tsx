import { PageHeader } from "@/components/ui/page-header";

import { AgentRow } from "../../modules/agents/components/agent-row.js";
import { ShareModalDemo } from "./share-modal-demo.js";
import { resolveAgentDisplay } from "../../modules/agents/utils/agent-resolver.js";
import { ConnectionIcon } from "../../modules/connections/components/connection-icon.js";
import type { AgentView } from "../../types.js";
import {
  bareAgent,
  demoPackAgent,
  errorAgent,
  experimentAgent,
  fixtureSchedules,
  fullAgent,
  hibernatedUnknownSkills,
  knowledgeBaseAgent,
  neverHibernatesButHibernated,
  neverHibernatesOverBudget,
  packSkippedAgent,
  singularAgent,
} from "./agent-card-fixtures.js";

interface CardDemoProps {
  title: string;
  note: string;
  agent: AgentView;
  temporaryDraw?: { count: number; cpuMilli: number; memoryMi: number };
}

function CardDemo({ title, note, agent, temporaryDraw }: CardDemoProps) {
  const display = resolveAgentDisplay(agent, new Set(), new Set());
  const scheduleCount = fixtureSchedules.filter(
    (s) => s.agentId === agent.id && s.enabled,
  ).length;

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
        updatePending={false}
        updateBusy={false}
        onSelect={noop}
        onUpdate={noop}
        onConfigure={noop}
        configureLabel="Configure agent"
        onWake={noop}
        onRestart={noop}
        onPause={noop}
        onStop={noop}
        onDelete={noop}
        scheduleCount={scheduleCount || undefined}
      />
    </div>
  );
}

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
          title="1. Full card"
          note="Slack channels, schedules, always-on, running."
          agent={fullAgent}
        />

        <CardDemo
          title="2. Bare card"
          note="Nothing attached. The metadata row should be absent."
          agent={bareAgent}
        />

        <CardDemo
          title="3. One-of-each"
          note="Singular forms: 1 channel, 1 schedule."
          agent={singularAgent}
        />

        <CardDemo
          title="4. Hibernated"
          note="Common real case: agent is hibernated."
          agent={hibernatedUnknownSkills}
        />

        <CardDemo
          title="5a. Always-on but currently hibernated"
          note="Never-hibernates but stopped — shows Idle (Always-on) badge."
          agent={neverHibernatesButHibernated}
        />

        <CardDemo
          title="5b. Always-on but over budget"
          note="Always-on badge only shows when running — this shows Over budget badge."
          agent={neverHibernatesOverBudget}
        />

        <CardDemo
          title="6. Knowledge base"
          note="Just an agent now — no special kind badge."
          agent={knowledgeBaseAgent}
        />

        <CardDemo
          title="7. Experiment"
          note="Just an agent now — no special kind badge."
          agent={experimentAgent}
        />

        <CardDemo
          title="8. Pack-created agent"
          note="No pack badge shown — pack is just a starting template."
          agent={packSkippedAgent}
        />

        <CardDemo
          title="9. Error state with contribution failures"
          note="Error badge, contribution failures badge, error status."
          agent={errorAgent}
        />

        <CardDemo
          title="10. Demo agent"
          note="Running agent created from a pack."
          agent={demoPackAgent}
        />

        {/* Overflow menu — static render for screenshot */}
        <div>
          <div className="mb-2">
            <p className="text-sm font-semibold text-foreground">
              11. Overflow menu
            </p>
            <p className="text-sm text-muted-foreground">
              Static render of the agent card dropdown menu.
            </p>
          </div>
          <div className="inline-flex min-w-[200px] flex-col rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
            <div className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-3 text-sm hover:bg-muted">
              Configure agent
            </div>
            <div className="my-1 h-px bg-border" />
            <div className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-3 text-sm hover:bg-muted">
              <ConnectionIcon iconSlug="slack" alt="" size={16} />
              Add to Slack channel
            </div>
            <div className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-3 text-sm hover:bg-muted">
              <ConnectionIcon iconSlug="telegram" alt="" size={16} />
              Add to Telegram chat
            </div>
            <div className="my-1 h-px bg-border" />
            <div className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-3 text-sm hover:bg-muted">
              Restart
            </div>
            <div className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-3 text-sm hover:bg-muted">
              Pause — wakes on next use
            </div>
            <div className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-3 text-sm hover:bg-muted">
              Stop — until started again
            </div>
            <div className="my-1 h-px bg-border" />
            <div className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-3 text-sm text-danger hover:bg-danger-light">
              Delete agent
            </div>
          </div>
        </div>

        {/* Share modal */}
        <div>
          <div className="mb-2">
            <p className="text-sm font-semibold text-foreground">
              12. Share modal
            </p>
            <p className="text-sm text-muted-foreground">
              Three access levels: Private, Restricted (invite by email), Public
              (copy link).
            </p>
          </div>
          <ShareModalDemo />
        </div>
      </div>
    </div>
  );
}
