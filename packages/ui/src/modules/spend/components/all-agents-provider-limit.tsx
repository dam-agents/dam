import { connectionLimitRule } from "api-server-api";

import { useOwnerSpendStatus } from "../api/queries.js";
import { allAgentsConnectionLimitName } from "../lib/copy.js";
import { connectionDisplayName } from "../lib/level-labels.js";
import { allAgentsConnectionLevels, spentOn } from "../lib/limit-levels.js";
import { SpendPill } from "./provider-spend-badge.js";

interface Props {
  connectionId: string;
  connectionName: string;
  templateId: string;
}

/** UNIT_BOUNDARY_DESCRIPTION: a provider's spend across all the owner's agents, as the pill on its Settings row; a provider that takes no limit shows none. */
export function AllAgentsSpendBadge({
  connectionId,
  connectionName,
  templateId,
}: Props) {
  const rule = connectionLimitRule(templateId);
  const { data: status } = useOwnerSpendStatus();
  if (!rule.limitable || !status) return null;
  const name = connectionDisplayName(connectionName, templateId);
  const view = allAgentsConnectionLevels(
    status,
    { id: connectionId, name, templateId },
    rule.unit,
  );
  return (
    <SpendPill
      spentMicros={spentOn(
        status.ownerSpentByConnection,
        connectionId,
        rule.unit,
      )}
      amountMicros={view.current?.amountMicros ?? null}
      unit={rule.unit}
      scope={{ kind: "owner-connection", connectionId }}
      subject={allAgentsConnectionLimitName(name)}
    />
  );
}
