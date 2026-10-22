import {
  connectionLimitRule,
  type SpendStatus,
  type SpendUnit,
} from "api-server-api";

import { useAgentDisplayName } from "../../agents/api/queries.js";
import { useRootDriver } from "../../agents/hooks/use-root-driver.js";
import { useProviderConnections } from "../../sessions/api/session-pair.js";
import type { ProviderConnectionRef } from "../../sessions/lib/session-pair-options.js";
import { useAgentSpendStatus } from "../api/queries.js";
import { useLevelAgent } from "../hooks/use-level-agent.js";
import { agentLimitOf } from "../lib/agent-limit.js";
import {
  AGENT_LIMIT_HELP,
  alsoSpent,
  highEstimates,
  usedToday,
} from "../lib/copy.js";
import {
  type AgentLimitCoverage,
  agentLimitCoverage,
} from "../lib/coverage.js";
import { agentLevels, type LevelConnection } from "../lib/limit-levels.js";
import { unitTotals } from "../lib/measured-spend.js";
import { AgentLimitCoverageNote } from "./agent-limit-coverage-note.js";
import { AlsoCountedBy } from "./also-counted-by.js";
import { DailyLimitCard, DailyLimitCardPending } from "./daily-limit-card.js";
import { DailyLimitMeter } from "./daily-limit-meter.js";
import { RootDriverSpendNote } from "./root-driver-spend-note.js";
import { SpendLimitButton } from "./spend-limit-button.js";

export function AgentSpendLimitCard({ agentId }: { agentId: string }) {
  const root = useRootDriver(agentId);
  if (root === undefined) return <DailyLimitCardPending failed={false} />;
  if (root) {
    return (
      <DailyLimitCard>
        <RootDriverSpendNote root={root} />
      </DailyLimitCard>
    );
  }
  return <DriverSpendLimitCard agentId={agentId} />;
}

function DriverSpendLimitCard({ agentId }: { agentId: string }) {
  const { data: status, isError } = useAgentSpendStatus(agentId);
  const { granted, loaded, failed } = useProviderConnections(agentId);
  if (!status || !(loaded || failed)) {
    return <DailyLimitCardPending help={AGENT_LIMIT_HELP} failed={isError} />;
  }
  return (
    <DriverSpendLimitBody
      agentId={agentId}
      granted={granted}
      status={status}
      coverage={agentLimitCoverage(granted.map((p) => p.templateId))}
      coverageKnown={loaded}
    />
  );
}

interface BodyProps {
  agentId: string;
  granted: readonly ProviderConnectionRef[];
  status: SpendStatus;
  coverage: AgentLimitCoverage;
  coverageKnown: boolean;
}

function DriverSpendLimitBody({
  agentId,
  granted,
  status,
  coverage,
  coverageKnown,
}: BodyProps) {
  const agentName = useAgentDisplayName(agentId);
  const limit = agentLimitOf(status, agentId);
  const settable = coverage.paid || limit !== undefined;
  const primary: SpendUnit = settable
    ? "usd"
    : (coverage.uncountedUnits[0] ?? "usd");
  const totals = unitTotals(status.spent);
  const agent = useLevelAgent(agentId);
  const view = agentLevels(status, agentId, levelConnections(granted));

  return (
    <DailyLimitCard
      help={AGENT_LIMIT_HELP}
      resetsAt={status.resetsAt}
      action={
        settable && (
          <SpendLimitButton
            scope={{ kind: "agent", agentId }}
            subject={agentName}
            amountMicros={limit?.amountMicros ?? null}
          />
        )
      }
    >
      {settable ? (
        <DailyLimitMeter
          spentMicros={totals.usd}
          limit={limit}
          resetsAt={status.resetsAt}
          subject={agentName}
        />
      ) : (
        <p className="text-sm text-foreground tabular-nums">
          {usedToday(totals[primary], primary)}
        </p>
      )}
      <OtherSpendLine status={status} primary={primary} />
      <AlsoCountedBy
        levels={view.others}
        agentId={agentId}
        agent={agent}
        grouped
      />
      {coverageKnown && !coverage.paid && limit === undefined && (
        <AgentLimitCoverageNote
          agentId={agentId}
          coverage={coverage}
          hasLimit={false}
        />
      )}
    </DailyLimitCard>
  );
}

function OtherSpendLine({
  status,
  primary,
}: {
  status: SpendStatus;
  primary: SpendUnit;
}) {
  const others = status.spent.filter(
    (total) => total.unit !== primary && total.costMicros > 0,
  );
  const estimated = status.spent.reduce(
    (sum, total) => sum + total.estimatedCalls,
    0,
  );
  const text = [
    others.length > 0 ? alsoSpent(others) : null,
    estimated > 0 ? highEstimates(estimated) : null,
  ]
    .filter(Boolean)
    .join(" ");
  if (!text) return null;

  return <p className="text-sm text-muted-foreground">{text}</p>;
}

function levelConnections(
  granted: readonly ProviderConnectionRef[],
): (LevelConnection & { unit: SpendUnit })[] {
  return granted.flatMap((ref) => {
    if (!ref.templateId) return [];
    const rule = connectionLimitRule(ref.templateId);
    return rule.limitable
      ? [
          {
            id: ref.id,
            name: ref.name,
            templateId: ref.templateId,
            unit: rule.unit,
          },
        ]
      : [];
  });
}
