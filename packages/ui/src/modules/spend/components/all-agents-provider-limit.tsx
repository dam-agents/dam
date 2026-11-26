import { connectionLimitRule } from "api-server-api";

import { useOwnerSpendStatus } from "../api/queries.js";
import {
  allAgentsConnectionLimitName,
  LIMIT_FOR_ALL_AGENTS,
} from "../lib/copy.js";
import { connectionDisplayName } from "../lib/level-labels.js";
import { allAgentsConnectionLevels, spentOn } from "../lib/limit-levels.js";
import {
  LimitChevron,
  ProviderLimitBlock,
  SpendToggle,
} from "./provider-limit-panel.js";
import { SpendLimitButton } from "./spend-limit-button.js";

interface Props {
  connectionId: string;
  connectionName: string;
  templateId: string;
}

interface Toggle {
  open: boolean;
  onToggle: () => void;
  controls: string;
}

function useAllAgentsSpend({
  connectionId,
  connectionName,
  templateId,
}: Props) {
  const rule = connectionLimitRule(templateId);
  const { data: status } = useOwnerSpendStatus();
  if (!rule.limitable || !status) return null;
  const connection = {
    id: connectionId,
    name: connectionDisplayName(connectionName, templateId),
    templateId,
  };
  return {
    unit: rule.unit,
    connection,
    subject: allAgentsConnectionLimitName(connection.name),
    level: allAgentsConnectionLevels(status, connection, rule.unit).current,
    spentMicros: spentOn(
      status.ownerSpentByConnection,
      connectionId,
      rule.unit,
    ),
    resetsAt: status.resetsAt,
  };
}

/** UNIT_BOUNDARY_DESCRIPTION: a provider's spend today across all the owner's agents, as the text on its Settings row that opens its limit for all agents; a provider that takes no limit shows none. */
export function AllAgentsSpendToggle({
  toggle,
  ...props
}: Props & { toggle: Toggle }) {
  const spend = useAllAgentsSpend(props);
  if (!spend) return null;
  return (
    <SpendToggle
      spentMicros={spend.spentMicros}
      unit={spend.unit}
      toggle={{ ...toggle, subject: spend.connection.name }}
    />
  );
}

export function AllAgentsLimitChevron({
  toggle,
  ...props
}: Props & { toggle: Toggle }) {
  const spend = useAllAgentsSpend(props);
  if (!spend) return null;
  return (
    <LimitChevron toggle={{ ...toggle, subject: spend.connection.name }} />
  );
}

/** UNIT_BOUNDARY_DESCRIPTION: the open part of a provider's Settings row: its limit for all agents, with the button that sets it and when it resets. */
export function AllAgentsLimitPanel({ id, ...props }: Props & { id: string }) {
  const spend = useAllAgentsSpend(props);
  if (!spend) return null;
  return (
    <div id={id} className="border-t border-border px-4 py-3">
      <ProviderLimitBlock
        icon={{ kind: "all-connection", connection: spend.connection }}
        agent={null}
        name={LIMIT_FOR_ALL_AGENTS}
        level={spend.level}
        spentMicros={spend.spentMicros}
        unit={spend.unit}
        resetsAt={spend.resetsAt}
        action={
          <SpendLimitButton
            scope={{
              kind: "owner-connection",
              connectionId: props.connectionId,
            }}
            subject={spend.subject}
            amountMicros={spend.level?.amountMicros ?? null}
            unit={spend.unit}
          />
        }
      />
    </div>
  );
}
