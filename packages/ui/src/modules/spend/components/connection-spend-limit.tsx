import { connectionLimitRule } from "api-server-api";

import { useAgentDisplayName } from "../../agents/api/queries.js";
import { useAgentSpendStatus } from "../api/queries.js";
import {
  CONNECTION_LIMIT_TITLE,
  connectionLimitHelp,
  resetsAtLine,
} from "../lib/copy.js";
import {
  localResetTime,
  NO_LIMIT_REASONS,
  UNIT_EXPLANATIONS,
} from "../lib/format.js";
import { DailyLimitMeter } from "./daily-limit-meter.js";
import { HelpTip } from "./help-tip.js";
import { SpendLimitButton } from "./spend-limit-button.js";

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
  const subject = `${agentName} on ${connectionName}`;

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {CONNECTION_LIMIT_TITLE}
          <HelpTip
            content={connectionLimitHelp(UNIT_EXPLANATIONS[rule.unit])}
          />
        </p>
        <SpendLimitButton
          scope={{ kind: "connection", agentId, connectionId }}
          subject={subject}
          amountMicros={limit?.amountMicros ?? null}
          unit={rule.unit}
        />
      </div>
      <DailyLimitMeter
        spentMicros={spentMicros}
        limit={limit}
        resetsAt={status.resetsAt}
        subject={subject}
        unit={rule.unit}
      />
      <p className="text-xs text-muted-foreground">
        {resetsAtLine(localResetTime(status.resetsAt))}
      </p>
    </div>
  );
}
