import { connectionLimitRule } from "api-server-api";

import { useOwnerSpendStatus } from "../api/queries.js";
import {
  ALL_AGENTS_LIMIT_BUTTON_TIP,
  allAgentsConnectionLimitName,
} from "../lib/copy.js";
import { NO_LIMIT_REASONS } from "../lib/format.js";
import { connectionDisplayName } from "../lib/level-labels.js";
import { allAgentsConnectionLevels } from "../lib/limit-levels.js";
import { LimitLine } from "./limit-line.js";

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

  const name = connectionDisplayName(connectionName, templateId);
  const connection = { id: connectionId, name, templateId };
  const spentMicros = status.ownerSpentByConnection
    .filter(
      (total) =>
        total.connectionId === connectionId && total.unit === rule.unit,
    )
    .reduce((sum, total) => sum + total.costMicros, 0);

  return (
    <LimitLine
      view={allAgentsConnectionLevels(status, connection, rule.unit)}
      spentMicros={spentMicros}
      unit={rule.unit}
      scope={{ kind: "owner-connection", connectionId }}
      subject={allAgentsConnectionLimitName(name)}
      buttonTip={ALL_AGENTS_LIMIT_BUTTON_TIP}
      agentId={null}
      agent={null}
    />
  );
}
