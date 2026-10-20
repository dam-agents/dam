import { Bot } from "@carbon/icons-react";
import {
  SPEND_SUB_AGENTS_MAX,
  SPEND_SUB_AGENTS_PAGE,
  type SpendBreakdown,
} from "api-server-api";
import { useState } from "react";

import { useSubAgentSpend } from "../api/queries.js";
import {
  agentLabel,
  agentNameOf,
  agentSources,
  inServerOrder,
  MORE_SUB_AGENTS_KEY,
  moreSubAgentsSource,
} from "../lib/breakdown-sources.js";
import {
  SHOW_LESS,
  showAllSubAgents,
  showMoreSubAgents,
  thisAgent,
} from "../lib/copy.js";
import { spendRows } from "../lib/spend-rows.js";
import { SpendAgentAvatar } from "./spend-agent-avatar.js";
import { SpendRowList } from "./spend-row-list.js";

const TEXT_BUTTON = "text-sm text-accent hover:underline";

function SubAgentIcon() {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center">
      <Bot size={14} className="text-accent" aria-hidden />
    </span>
  );
}

function agentIdsInOrder(rows: readonly { agentId: string }[]): string[] {
  return [...new Set(rows.map((row) => row.agentId))];
}

interface Props {
  agentId: string;
  breakdown: SpendBreakdown;
  showPlanUse: boolean;
}

export function DriverSpendByAgent({ agentId, breakdown, showPlanUse }: Props) {
  const [limit, setLimit] = useState(0);
  const { data: all } = useSubAgentSpend(
    { agentId, from: breakdown.from, to: breakdown.to },
    limit,
  );
  const asked = limit > 0;
  const expanded = asked && all !== undefined;
  const other = breakdown.otherSubAgents;
  const driverRows = breakdown.byCallingAgent.filter(
    (row) => row.agentId === agentId,
  );
  const subAgentRows = expanded
    ? all.rows
    : breakdown.byCallingAgent.filter((row) => row.agentId !== agentId);
  const subAgentIds = agentIdsInOrder(subAgentRows);
  const subAgentCount = expanded ? all.count : subAgentIds.length + other.count;
  const left = subAgentCount - subAgentIds.length;
  const rows = [...driverRows, ...subAgentRows];
  const nameOf = agentNameOf(rows);
  const sources = [
    ...agentSources(rows, (id, name) =>
      id === agentId ? thisAgent(name ?? id) : agentLabel(name),
    ),
    ...(!expanded && other.count > 0 ? [moreSubAgentsSource(other)] : []),
  ];
  const showMore = () =>
    setLimit((shown) =>
      Math.min(shown + SPEND_SUB_AGENTS_PAGE, SPEND_SUB_AGENTS_MAX),
    );

  return (
    <div className="flex flex-col gap-3">
      <SpendRowList
        rows={inServerOrder(spendRows(sources, showPlanUse), [
          agentId,
          ...subAgentIds,
        ])}
        iconOf={(id) => {
          if (id === agentId)
            return (
              <SpendAgentAvatar agentId={id} name={agentLabel(nameOf(id))} />
            );
          return id === MORE_SUB_AGENTS_KEY ? (
            <span className="size-4 shrink-0" aria-hidden />
          ) : (
            <SubAgentIcon />
          );
        }}
        indentOf={(id) => id !== agentId}
      />
      {(asked || other.count > 0) && (
        <div className="flex gap-4">
          {!asked && (
            <button type="button" onClick={showMore} className={TEXT_BUTTON}>
              {showAllSubAgents(subAgentCount)}
            </button>
          )}
          {expanded && left > 0 && (
            <button type="button" onClick={showMore} className={TEXT_BUTTON}>
              {showMoreSubAgents(Math.min(left, SPEND_SUB_AGENTS_PAGE))}
            </button>
          )}
          {asked && (
            <button
              type="button"
              onClick={() => setLimit(0)}
              className={TEXT_BUTTON}
            >
              {SHOW_LESS}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
