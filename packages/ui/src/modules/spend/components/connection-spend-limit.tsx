import { connectionLimitRule } from "api-server-api";

import { Tooltip } from "@/components/ui/tooltip";

import { useAgentDisplayName } from "../../agents/api/queries.js";
import { useAgentSpendStatus } from "../api/queries.js";
import { useLevelAgent } from "../hooks/use-level-agent.js";
import {
  AGENT_PROVIDER_LIMIT_BUTTON_TIP,
  allAgentsOn,
  LIMIT_ON_THE_AGENT,
} from "../lib/copy.js";
import { levelName } from "../lib/level-labels.js";
import {
  agentConnectionLevels,
  type LevelsView,
  spentOn,
} from "../lib/limit-levels.js";
import { LimitRow } from "./limit-row.js";
import { ProviderLimitBlock } from "./provider-limit-panel.js";
import { SpendLimitButton } from "./spend-limit-button.js";

export function useConnectionSpendLimit({
  agentId,
  connectionId,
  connectionName,
  templateId,
}: {
  agentId: string | null;
  connectionId: string;
  connectionName: string;
  templateId: string;
}) {
  const rule = connectionLimitRule(templateId);
  const { data: status } = useAgentSpendStatus(rule.limitable ? agentId : null);
  const agentName = useAgentDisplayName(agentId);
  const agent = useLevelAgent(agentId);
  if (!rule.limitable || !status || !agentId) return null;
  const connection = { id: connectionId, name: connectionName, templateId };
  const view = agentConnectionLevels(status, agentId, connection, rule.unit);
  const spentMicros = spentOn(
    status.spentByConnection,
    connectionId,
    rule.unit,
  );
  return {
    rule,
    view,
    agent,
    connection,
    resetsAt: status.resetsAt,
    spentMicros,
    subject: `${agentName} on ${connectionName}`,
    compare: {
      spentMicros,
      extensions: view.current?.extensions ?? 0,
      other: firstOther(view),
    },
  };
}

/** UNIT_BOUNDARY_DESCRIPTION: the open part of an agent's provider row: the agent's own limit there, with the button that sets it and when it resets, then, under a hairline, the provider's limit for all agents. */
export function AgentProviderLimitPanel({
  id,
  spend,
  agentId,
  connectionId,
}: {
  id: string;
  spend: NonNullable<ReturnType<typeof useConnectionSpendLimit>>;
  agentId: string;
  connectionId: string;
}) {
  const { view, rule, agent, connection } = spend;
  const all = view.others.find(
    ({ level }) => level.kind === "all-connection",
  )?.level;
  return (
    <div
      id={id}
      className="flex flex-col gap-3 border-t border-border px-4 py-3"
    >
      <ProviderLimitBlock
        icon={{ kind: "agent", connection: null }}
        agent={agent}
        name={LIMIT_ON_THE_AGENT}
        level={view.current}
        spentMicros={spend.spentMicros}
        unit={rule.unit}
        resetsAt={spend.resetsAt}
        action={
          <Tooltip content={AGENT_PROVIDER_LIMIT_BUTTON_TIP}>
            <span>
              <SpendLimitButton
                scope={{ kind: "connection", agentId, connectionId }}
                subject={spend.subject}
                amountMicros={view.current?.amountMicros ?? null}
                unit={rule.unit}
                compare={spend.compare}
              />
            </span>
          </Tooltip>
        }
      />
      {all && (
        <div className="border-t border-border pt-3">
          <LimitRow
            level={all}
            agent={null}
            name={allAgentsOn(connection.name)}
          />
        </div>
      )}
    </div>
  );
}

function firstOther(
  view: LevelsView,
): { name: string; leftMicros: number } | null {
  const nearest = view.others.reduce<LevelsView["others"][number] | null>(
    (best, entry) =>
      best === null || entry.level.leftMicros < best.level.leftMicros
        ? entry
        : best,
    null,
  );
  return nearest
    ? { name: levelName(nearest.level), leftMicros: nearest.level.leftMicros }
    : null;
}
