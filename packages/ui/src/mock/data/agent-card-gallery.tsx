import { PageHeader } from "@/components/ui/page-header";

import { AgentRow } from "../../modules/agents/components/agent-row.js";
import { resolveAgentDisplay } from "../../modules/agents/utils/agent-resolver.js";
import { ConnectionIcon } from "../../modules/connections/components/connection-icon.js";
import type { AgentView } from "../../types.js";
import {
  allFixtureAgents,
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
  temporaryDriverAgent,
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
          title="10. Temporary-agent driver"
          note="The bottom line showing temporary agents running."
          agent={temporaryDriverAgent}
          temporaryDraw={{ count: 3, cpuMilli: 6000, memoryMi: 6144 }}
        />

        <CardDemo
          title="11. Demo agent"
          note="Running agent created from a pack."
          agent={demoPackAgent}
        />

        {/* Overflow menu — static render for screenshot */}
        <div>
          <div className="mb-2">
            <p className="text-sm font-semibold text-foreground">
              12. Overflow menu
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

        {/* Empty list states */}
        <div>
          <div className="mb-2">
            <p className="text-sm font-semibold text-foreground">
              13. Empty list — agents page
            </p>
            <p className="text-sm text-muted-foreground">
              No agents at all. The empty state should show the PageEmptyState
              component.
            </p>
          </div>
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Empty state: "No agents yet" with a Create agent button. Rendered by
            AgentsView when the list is empty.
          </div>
        </div>

        {/* Bind pickers — the second card shape */}
        <div>
          <div className="mb-2">
            <p className="text-sm font-semibold text-foreground">
              14. Bind pickers (Slack + Telegram)
            </p>
            <p className="text-sm text-muted-foreground">
              BindAgentRow stays deliberately reduced — it is a picker, not a
              scanner.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            {allFixtureAgents.slice(0, 3).map((a) => (
              <div
                key={a.id}
                className="flex flex-col items-start gap-0.5 rounded-lg border border-border px-4 py-3"
              >
                <span className="text-sm font-semibold text-foreground">
                  {a.name}
                </span>
                {a.description && (
                  <span className="text-xs text-muted-foreground">
                    {a.description}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
