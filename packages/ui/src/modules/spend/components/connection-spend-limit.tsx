import { connectionLimitRule } from "api-server-api";

import { useAgentDisplayName } from "../../agents/api/queries.js";
import { useAgentSpendStatus } from "../api/queries.js";
import { useLevelAgent } from "../hooks/use-level-agent.js";
import { AGENT_PROVIDER_LIMIT_BUTTON_TIP } from "../lib/copy.js";
import { NO_LIMIT_REASONS } from "../lib/format.js";
import { levelName } from "../lib/level-labels.js";
import {
  agentConnectionLevels,
  type LevelsView,
  spentOn,
} from "../lib/limit-levels.js";
import { LimitLine } from "./limit-line.js";

interface Props {
  agentId: string;
  connectionId: string;
  connectionName: string;
  templateId: string;
  compact?: boolean;
}

export function useConnectionSpendLimit({
  agentId,
  connectionId,
  connectionName,
  templateId,
}: {
  agentId: string;
  connectionId: string;
  connectionName: string;
  templateId: string;
}) {
  const rule = connectionLimitRule(templateId);
  const { data: status } = useAgentSpendStatus(rule.limitable ? agentId : null);
  const agentName = useAgentDisplayName(agentId);
  const agent = useLevelAgent(agentId);
  if (!rule.limitable || !status) return null;
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
    spentMicros,
    subject: `${agentName} on ${connectionName}`,
    compare: {
      spentMicros,
      extensions: view.current?.extensions ?? 0,
      other: firstOther(view),
    },
  };
}

export function ConnectionSpendLimit({
  agentId,
  connectionId,
  connectionName,
  templateId,
  compact = false,
}: Props) {
  const spend = useConnectionSpendLimit({
    agentId,
    connectionId,
    connectionName,
    templateId,
  });
  const rule = connectionLimitRule(templateId);
  if (!rule.limitable) {
    if (compact) return null;
    return (
      <p className="border-t border-border pt-3 text-xs text-muted-foreground">
        {NO_LIMIT_REASONS[rule.reason]}
      </p>
    );
  }
  if (!spend) return null;

  return (
    <div className="border-t border-border pt-3">
      <LimitLine
        view={spend.view}
        spentMicros={spend.spentMicros}
        unit={rule.unit}
        scope={{ kind: "connection", agentId, connectionId }}
        subject={spend.subject}
        buttonTip={AGENT_PROVIDER_LIMIT_BUTTON_TIP}
        agentId={agentId}
        agent={spend.agent}
        compact={compact}
        compare={spend.compare}
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
