import { providerTypeForTemplateId } from "api-server-api";
import { useMemo } from "react";

import { PageHeader } from "@/components/ui/page-header";

import { AgentRow } from "../../modules/agents/components/agent-row.js";
import { resolveAgentDisplay } from "../../modules/agents/utils/agent-resolver.js";
import {
  sandboxSubtitle,
  type SandboxSubtitleLookup,
} from "../../modules/agents/utils/sandbox-subtitle.js";
import type { AgentView } from "../../types.js";
import {
  allFixtureAgents,
  bareAgent,
  demoPackAgent,
  errorAgent,
  experimentAgent,
  fixturePackProvenance,
  fixtureSchedules,
  fixtureSkillCounts,
  fullAgent,
  hibernatedUnknownSkills,
  knowledgeBaseAgent,
  neverHibernatesButHibernated,
  neverHibernatesOverBudget,
  packSkippedAgent,
  singularAgent,
  temporaryDriverAgent,
} from "./agent-card-fixtures.js";
import { connections } from "./connections.js";
import { templates } from "./templates.js";

const PACKS_BY_ID: Record<string, string> = {
  "design-prototyper": "Design prototyper",
  "link-monitor": "Broken link monitor",
  "code-reviewer": "Code reviewer",
};

const CONNECTION_TEMPLATE_BY_ID = new Map(
  connections.map((c) => [c.id, c.templateId]),
);

function nonProviderConnectionCount(agent: AgentView): number {
  let count = 0;
  for (const cid of agent.grantedConnectionIds) {
    const tid = CONNECTION_TEMPLATE_BY_ID.get(cid);
    if (tid && providerTypeForTemplateId(tid)) continue;
    count += 1;
  }
  return count;
}

function useSubtitleLookup(): SandboxSubtitleLookup {
  return useMemo(
    () => ({
      templateNameById: new Map(templates.map((t) => [t.id, t.name])),
      connectionTemplateIdById: CONNECTION_TEMPLATE_BY_ID,
    }),
    [],
  );
}

interface CardDemoProps {
  title: string;
  note: string;
  agent: AgentView;
  lookup: SandboxSubtitleLookup;
  temporaryDraw?: { count: number; cpuMilli: number; memoryMi: number };
}

function CardDemo({
  title,
  note,
  agent,
  lookup,
  temporaryDraw,
}: CardDemoProps) {
  const display = resolveAgentDisplay(agent, new Set(), new Set());
  const subtitle = sandboxSubtitle(agent, lookup);
  const packId = fixturePackProvenance[agent.id];
  const packName = packId ? (PACKS_BY_ID[packId] ?? packId) : undefined;
  const skills = fixtureSkillCounts[agent.id];
  const skillCount = skills
    ? skills.installed + skills.standalone
    : skills === null
      ? null
      : undefined;
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
        subtitle={subtitle}
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
        connectionCount={nonProviderConnectionCount(agent)}
        packName={packName}
        skillCount={skillCount}
        scheduleCount={scheduleCount || undefined}
      />
    </div>
  );
}

export function AgentCardGallery() {
  const lookup = useSubtitleLookup();

  return (
    <div>
      <PageHeader
        title="Agent card gallery"
        description="Every §5 state, rendered side by side. This page is a design review surface — it does not appear in production."
      />

      <div className="flex flex-col gap-8">
        <CardDemo
          title="1. Full card"
          note="Pack, both messengers, connections, schedules, skills known, never-hibernates, running."
          agent={fullAgent}
          lookup={lookup}
        />

        <CardDemo
          title="2. Bare card"
          note="Nothing attached, no pack. The attachments row should be absent."
          agent={bareAgent}
          lookup={lookup}
        />

        <CardDemo
          title="3. One-of-each"
          note="Singular forms: 1 channel, 1 connection, 1 schedule, 1 skill."
          agent={singularAgent}
          lookup={lookup}
        />

        <CardDemo
          title="4. Hibernated, unknown skills"
          note="The common real case: skills not reachable because the agent is hibernated."
          agent={hibernatedUnknownSkills}
          lookup={lookup}
        />

        <CardDemo
          title="5a. Never-hibernates but currently hibernated"
          note="Contradiction: 'Never hibernates' chip + 'Hibernating' status badge — visually separate."
          agent={neverHibernatesButHibernated}
          lookup={lookup}
        />

        <CardDemo
          title="5b. Never-hibernates but over budget"
          note="Second contradiction: 'Never hibernates' chip + 'Over budget' status badge."
          agent={neverHibernatesOverBudget}
          lookup={lookup}
        />

        <CardDemo
          title="6. Knowledge base"
          note="Kind badge 'Knowledge base' present. configureLabel would say 'Configure knowledge base'."
          agent={knowledgeBaseAgent}
          lookup={lookup}
        />

        <CardDemo
          title="7. Experiment"
          note="Kind badge 'Experiment' present."
          agent={experimentAgent}
          lookup={lookup}
        />

        <CardDemo
          title="8. Pack applied, partly skipped"
          note="Pack provenance badge present. The agent may have drifted from the pack config."
          agent={packSkippedAgent}
          lookup={lookup}
        />

        <CardDemo
          title="9. Error state with contribution failures"
          note="Error badge, contribution failures badge, error status."
          agent={errorAgent}
          lookup={lookup}
        />

        <CardDemo
          title="10. Temporary-agent driver"
          note="The bottom line showing temporary agents running."
          agent={temporaryDriverAgent}
          lookup={lookup}
          temporaryDraw={{ count: 3, cpuMilli: 6000, memoryMi: 6144 }}
        />

        <CardDemo
          title="11. Demo agent (packs branch)"
          note="Badged with a pack. Simulates a demo agent from the packs page."
          agent={demoPackAgent}
          lookup={lookup}
        />

        {/* Empty list states */}
        <div>
          <div className="mb-2">
            <p className="text-sm font-semibold text-foreground">
              12. Empty list — agents page
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

        <div>
          <div className="mb-2">
            <p className="text-sm font-semibold text-foreground">
              13. Empty list — knowledge bases page
            </p>
            <p className="text-sm text-muted-foreground">
              No knowledge bases. The empty state from KnowledgeBasesListView.
            </p>
          </div>
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Empty state: "No knowledge bases yet" with a Create knowledge base
            button.
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
              scanner. The user is choosing which agent to bind, not monitoring
              status. Decision: converge on shared identity line (name + kind
              badge + description) but omit attachments and status. See
              SCOPE.md.
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
