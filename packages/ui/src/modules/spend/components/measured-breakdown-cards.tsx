import type { SpendBreakdown } from "api-server-api";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";

import { useAgentsList } from "../../agents/api/queries.js";
import { AgentAvatar } from "../../agents/components/avatar/agent-avatar.js";
import { useAppConnections } from "../../connections/api/queries.js";
import {
  agentSources,
  connectionSources,
  modelSources,
} from "../lib/breakdown-sources.js";
import {
  SPEND_BY_AGENT,
  SPEND_BY_MODEL,
  SPEND_BY_PROVIDER,
} from "../lib/copy.js";
import { spendRows } from "../lib/spend-rows.js";
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

interface Props {
  breakdown: SpendBreakdown;
  showPlanUse: boolean;
  showAgents: boolean;
}

export function MeasuredBreakdownCards({
  breakdown,
  showPlanUse,
  showAgents,
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
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {showAgents && (
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
    </div>
  );
}
