import { connectionLimitRule } from "api-server-api";

import { useAgentDisplayName } from "../../agents/api/queries.js";
import { useAgentSpendStatus } from "../api/queries.js";
import { useLevelAgent } from "../hooks/use-level-agent.js";
import { AGENT_PROVIDER_LIMIT_BUTTON_TIP } from "../lib/copy.js";
import { NO_LIMIT_REASONS } from "../lib/format.js";
import { levelName } from "../lib/level-labels.js";
import { agentConnectionLevels, type LevelsView } from "../lib/limit-levels.js";
import { LimitLine } from "./limit-line.js";

interface Props {
  agentId: string;
  connectionId: string;
  connectionName: string;
  templateId: string;
}

export function ConnectionSpendLimit({
  agentId,
  connectionId,
  connectionName,
  templateId,
}: Props) {
  const rule = connectionLimitRule(templateId);
  const { data: status } = useAgentSpendStatus(rule.limitable ? agentId : null);
  const agentName = useAgentDisplayName(agentId);
  const agent = useLevelAgent(agentId);
  if (!rule.limitable) {
    return (
      <p className="border-t border-border pt-3 text-xs text-muted-foreground">
        {NO_LIMIT_REASONS[rule.reason]}
      </p>
    );
  }
  if (!status) return null;

  const connection = { id: connectionId, name: connectionName, templateId };
  const view = agentConnectionLevels(status, agentId, connection, rule.unit);
  const spentMicros = status.spentByConnection
    .filter(
      (total) =>
        total.connectionId === connectionId && total.unit === rule.unit,
    )
    .reduce((sum, total) => sum + total.costMicros, 0);

  return (
    <div className="border-t border-border pt-3">
      <LimitLine
        view={view}
        spentMicros={spentMicros}
        unit={rule.unit}
        scope={{ kind: "connection", agentId, connectionId }}
        subject={`${agentName} on ${connectionName}`}
        buttonTip={AGENT_PROVIDER_LIMIT_BUTTON_TIP}
        agentId={agentId}
        agent={agent}
        compare={{
          spentMicros,
          extensions: view.current?.extensions ?? 0,
          other: firstOther(view),
        }}
      />
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
