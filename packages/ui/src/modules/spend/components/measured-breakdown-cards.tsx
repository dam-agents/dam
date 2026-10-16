import type { SpendBreakdown } from "api-server-api";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";

import { useAgentsList } from "../../agents/api/queries.js";
import { AgentAvatar } from "../../agents/components/avatar/agent-avatar.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { SESSION_CATEGORY_LABELS } from "../../sessions/lib/session-category.js";
import {
  agentSources,
  connectionSources,
  modelSources,
  type SessionType,
  sessionTypeSources,
} from "../lib/breakdown-sources.js";
import {
  NO_SESSION,
  noSessionHelp,
  SPEND_BY_AGENT,
  SPEND_BY_MODEL,
  SPEND_BY_PROVIDER,
  SPEND_BY_SESSION_TYPE,
  SUB_AGENTS,
  SUB_AGENTS_HELP,
  thisAgent,
} from "../lib/copy.js";
import { type SpendRow, spendRows } from "../lib/spend-rows.js";
import { SpendRowList } from "./spend-row-list.js";

function BreakdownCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Card className="p-5">
      <SectionLabel spaced>{title}</SectionLabel>
      {children}
    </Card>
  );
}

function describeSessionType(category: SessionType): {
  label: string;
  help?: string;
} {
  if (category === "subagents")
    return { label: SUB_AGENTS, help: SUB_AGENTS_HELP };
  if (category === "none") return { label: NO_SESSION, help: noSessionHelp() };
  return { label: SESSION_CATEGORY_LABELS[category] };
}

function firstRow(rows: SpendRow[], key: string): SpendRow[] {
  return [
    ...rows.filter((row) => row.key === key),
    ...rows.filter((row) => row.key !== key),
  ];
}

interface Props {
  agentId?: string;
  breakdown: SpendBreakdown;
  showPlanUse: boolean;
}

export function MeasuredBreakdownCards({
  agentId,
  breakdown,
  showPlanUse,
}: Props) {
  const agents = useAgentsList();
  const { data: connections = [] } = useAppConnections();
  const agentOf = (agentId: string) => agents.find((a) => a.id === agentId);
  const agentIcon = (agentId: string) => {
    const agent = agentOf(agentId);
    return (
      <AgentAvatar
        name={agent?.name ?? agentId}
        avatar={agent?.avatar}
        size={16}
      />
    );
  };
  const subAgentSpend = breakdown.byCallingAgent.some(
    (row) => row.agentId !== agentId && row.costMicros > 0,
  );
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {agentId === undefined && (
        <BreakdownCard title={SPEND_BY_AGENT}>
          <SpendRowList
            rows={spendRows(
              agentSources(breakdown.byAgent, (id) => agentOf(id)?.name),
              showPlanUse,
            )}
            iconOf={agentIcon}
          />
        </BreakdownCard>
      )}
      {agentId !== undefined && subAgentSpend && (
        <BreakdownCard title={SPEND_BY_AGENT}>
          <SpendRowList
            rows={firstRow(
              spendRows(
                agentSources(breakdown.byCallingAgent, (id) => {
                  const name = agentOf(id)?.name;
                  return id === agentId ? thisAgent(name ?? id) : name;
                }),
                showPlanUse,
              ),
              agentId,
            )}
            iconOf={agentIcon}
          />
        </BreakdownCard>
      )}
      <BreakdownCard title={SPEND_BY_MODEL}>
        <SpendRowList
          rows={spendRows(modelSources(breakdown.byModel), showPlanUse)}
        />
      </BreakdownCard>
      <BreakdownCard title={SPEND_BY_PROVIDER}>
        <SpendRowList
          rows={spendRows(
            connectionSources(breakdown.byConnection, connections),
            showPlanUse,
          )}
        />
      </BreakdownCard>
      <BreakdownCard title={SPEND_BY_SESSION_TYPE}>
        <SpendRowList
          rows={spendRows(
            sessionTypeSources(breakdown.bySessionType, describeSessionType),
            showPlanUse,
          )}
        />
      </BreakdownCard>
    </div>
  );
}
