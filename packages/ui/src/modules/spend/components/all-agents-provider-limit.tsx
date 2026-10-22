import { connectionLimitRule } from "api-server-api";

import { useOwnerSpendStatus } from "../api/queries.js";
import {
  ALL_AGENTS_PROVIDER_LIMIT_TITLE,
  allAgentsConnectionLimitName,
  allAgentsProviderLimitHelp,
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
  connectionId: string;
  connectionName: string;
  templateId: string;
}

export function AllAgentsProviderLimit({
  connectionId,
  connectionName,
  templateId,
}: Props) {
  const rule = connectionLimitRule(templateId);
  const { data: status } = useOwnerSpendStatus();
  if (!rule.limitable) {
    return (
      <p className="text-xs text-muted-foreground">
        {NO_LIMIT_REASONS[rule.reason]}
      </p>
    );
  }
  if (!status) return null;

  const limit = status.limits.find(
    (view) =>
      view.scope.kind === "owner-connection" &&
      view.scope.connectionId === connectionId,
  );
  const spentMicros = status.ownerSpentByConnection
    .filter(
      (total) =>
        total.connectionId === connectionId && total.unit === rule.unit,
    )
    .reduce((sum, total) => sum + total.costMicros, 0);
  const subject = allAgentsConnectionLimitName(connectionName);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {ALL_AGENTS_PROVIDER_LIMIT_TITLE}
          <HelpTip
            content={allAgentsProviderLimitHelp(UNIT_EXPLANATIONS[rule.unit])}
          />
        </p>
        <SpendLimitButton
          scope={{ kind: "owner-connection", connectionId }}
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
      {limit && (
        <p className="text-xs text-muted-foreground">
          {resetsAtLine(localResetTime(status.resetsAt))}
        </p>
      )}
    </div>
  );
}
