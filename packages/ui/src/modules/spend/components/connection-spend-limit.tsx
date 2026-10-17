import { connectionLimitRule } from "api-server-api";

import { useAgentDisplayName } from "../../agents/api/queries.js";
import { useAgentSpendStatus } from "../api/queries.js";
import { NO_LIMIT_REASONS, UNIT_EXPLANATIONS } from "../lib/format.js";
import { SpendLimitLine } from "./spend-limit-line.js";

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
  if (!rule.limitable) {
    return (
      <p className="border-t border-border pt-3 text-xs text-muted-foreground">
        {NO_LIMIT_REASONS[rule.reason]}
      </p>
    );
  }
  if (!status) return null;

  const limit = status.limits.find(
    (view) =>
      view.scope.kind === "connection" &&
      view.scope.agentId === agentId &&
      view.scope.connectionId === connectionId,
  );
  const spentMicros = status.spentByConnection
    .filter(
      (total) =>
        total.connectionId === connectionId && total.unit === rule.unit,
    )
    .reduce((sum, total) => sum + total.costMicros, 0);
  const explanation = UNIT_EXPLANATIONS[rule.unit];

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <SpendLimitLine
        scope={{ kind: "connection", agentId, connectionId }}
        unit={rule.unit}
        spentMicros={spentMicros}
        limit={limit}
        subject={`${agentName} on ${connectionName}`}
        help={explanation}
      />
      {explanation && (
        <p className="text-xs text-muted-foreground">
          Only this limit stops calls on this provider. The agent spend limit
          and your spend limit do not count them.
        </p>
      )}
    </div>
  );
}
