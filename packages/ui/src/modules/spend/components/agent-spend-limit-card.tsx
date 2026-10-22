import type { SpendStatus, SpendUnit } from "api-server-api";

import { useAgentDisplayName } from "../../agents/api/queries.js";
import { useRootDriver } from "../../agents/hooks/use-root-driver.js";
import { useProviderConnections } from "../../sessions/api/session-pair.js";
import { useAgentSpendStatus } from "../api/queries.js";
import { agentLimitOf } from "../lib/agent-limit.js";
import {
  AGENT_LIMIT_HELP,
  alsoSpent,
  highEstimates,
  nearerLimitLine,
  usedToday,
} from "../lib/copy.js";
import {
  type AgentLimitCoverage,
  agentLimitCoverage,
} from "../lib/coverage.js";
import { unitTotals } from "../lib/measured-spend.js";
import { nearerOwnerWideLimit } from "../lib/nearer-limit.js";
import { AgentLimitCoverageNote } from "./agent-limit-coverage-note.js";
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
      status={status}
      coverage={agentLimitCoverage(granted.map((p) => p.templateId))}
      coverageKnown={loaded}
    />
  );
}

interface BodyProps {
  agentId: string;
  status: SpendStatus;
  coverage: AgentLimitCoverage;
  coverageKnown: boolean;
}

function DriverSpendLimitBody({
  agentId,
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
  const nearer = coverage.paid ? nearerOwnerWideLimit(status, agentId) : null;

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
      {nearer && (
        <p className="text-sm text-muted-foreground">
          {nearerLimitLine(nearer.kind, nearer.leftMicros)}
        </p>
      )}
      {coverageKnown && (
        <AgentLimitCoverageNote
          agentId={agentId}
          coverage={coverage}
          hasLimit={limit !== undefined}
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
