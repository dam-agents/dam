import { Bot } from "@carbon/icons-react";
import type { SpendBreakdown } from "api-server-api";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";

import { useAppConnections } from "../../connections/api/queries.js";
import { SESSION_CATEGORY_LABELS } from "../../sessions/lib/session-category.js";
import {
  agentLabel,
  agentNameOf,
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
import { SpendAgentAvatar } from "./spend-agent-avatar.js";
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
  const { data: connections = [] } = useAppConnections();
  const payerNameOf = agentNameOf(breakdown.byAgent);
  const callerNameOf = agentNameOf(breakdown.byCallingAgent);
  const subAgentSpend = breakdown.byCallingAgent.some(
    (row) => row.agentId !== agentId && row.costMicros > 0,
  );
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {agentId === undefined && (
        <BreakdownCard title={SPEND_BY_AGENT}>
          <SpendRowList
            rows={spendRows(agentSources(breakdown.byAgent), showPlanUse)}
            iconOf={(id) => (
              <SpendAgentAvatar
                agentId={id}
                name={agentLabel(payerNameOf(id))}
              />
            )}
          />
        </BreakdownCard>
      )}
      {agentId !== undefined && subAgentSpend && (
        <BreakdownCard title={SPEND_BY_AGENT}>
          <SpendRowList
            rows={firstRow(
              spendRows(
                agentSources(breakdown.byCallingAgent, (id, name) =>
                  id === agentId ? thisAgent(name ?? id) : agentLabel(name),
                ),
                showPlanUse,
              ),
              agentId,
            )}
            iconOf={(id) =>
              id === agentId ? (
                <SpendAgentAvatar
                  agentId={id}
                  name={agentLabel(callerNameOf(id))}
                />
              ) : (
                <span className="flex size-4 shrink-0 items-center justify-center">
                  <Bot size={14} className="text-accent" aria-hidden />
                </span>
              )
            }
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
