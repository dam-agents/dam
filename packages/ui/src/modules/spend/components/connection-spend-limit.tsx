import { connectionLimitRule } from "api-server-api";

import { useAgentSpendStatus } from "../api/queries.js";
import { formatSpend } from "../lib/format.js";
import { SpendLimitField } from "./spend-limit-field.js";
import { SpendLimitMeter } from "./spend-limit-meter.js";

interface Props {
  agentId: string;
  connectionId: string;
  templateId: string;
}

export function ConnectionSpendLimit({
  agentId,
  connectionId,
  templateId,
}: Props) {
  const rule = connectionLimitRule(templateId);
  const { data: status } = useAgentSpendStatus(rule.limitable ? agentId : null);
  if (!rule.limitable || !status) return null;

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

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <SpendLimitField
        label="Daily limit"
        scope={{ kind: "connection", agentId, connectionId }}
        unit={rule.unit}
        amountMicros={limit?.amountMicros ?? null}
      />
      {limit ? (
        <SpendLimitMeter
          label="Daily limit"
          unit={rule.unit}
          spentMicros={limit.spentMicros}
          limitMicros={limit.effectiveMicros}
          state={limit.state}
          extensions={limit.extensions}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          {formatSpend(spentMicros, rule.unit)} metered today
        </p>
      )}
    </div>
  );
}
