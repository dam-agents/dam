import { connectionLimitRule } from "api-server-api";

import { useAgentSpendStatus } from "../api/queries.js";
import {
  formatSpend,
  NO_LIMIT_REASONS,
  UNIT_EXPLANATIONS,
} from "../lib/format.js";
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
      <SpendLimitField
        label="Spend limit"
        help={explanation}
        scope={{ kind: "connection", agentId, connectionId }}
        unit={rule.unit}
        amountMicros={limit?.amountMicros ?? null}
      />
      {limit ? (
        <SpendLimitMeter
          label="Spend limit"
          unit={rule.unit}
          spentMicros={limit.spentMicros}
          limitMicros={limit.effectiveMicros}
          state={limit.state}
          extensions={limit.extensions}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          {formatSpend(spentMicros, rule.unit)} today
        </p>
      )}
      {explanation && (
        <p className="text-xs text-muted-foreground">
          Only this limit stops calls on this provider. The agent spend limit
          and your spend limit do not count them.
        </p>
      )}
    </div>
  );
}
