import {
  connectionLimitRule,
  type SpendStatus,
  type SpendUnit,
} from "api-server-api";
import { useEffect } from "react";

import { useStore } from "../../../store.js";
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
  callsAreEstimates,
  usedToday,
} from "../lib/copy.js";
import {
  type AgentLimitCoverage,
  agentLimitCoverage,
} from "../lib/coverage.js";
import { inListOrder } from "../lib/level-labels.js";
import { agentLevels, type LevelConnection } from "../lib/limit-levels.js";
import { unitTotals } from "../lib/measured-spend.js";
import { AgentLimitCoverageNote } from "./agent-limit-coverage-note.js";
import { DailyLimitCard, DailyLimitCardPending } from "./daily-limit-card.js";
import { DailyLimitMeter } from "./daily-limit-meter.js";
import { LimitRowList } from "./limit-row.js";
import { RootDriverSpendNote } from "./root-driver-spend-note.js";
import { SpendLimitButton } from "./spend-limit-button.js";

export const AGENT_LIMITS_ID = "agent-limits";

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
  useScrollToLimits(view.others.length > 0);

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
      {view.others.length > 0 && (
        <div className="border-t border-border pt-3">
          <LimitRowList
            id={AGENT_LIMITS_ID}
            levels={inListOrder(view.others.map(({ level }) => level))}
            agent={agent}
          />
        </div>
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

/** UNIT_BOUNDARY_DESCRIPTION: when the settings were opened to show what counts the agent, bring the list of its limits into view once it renders, then forget the request. */
function useScrollToLimits(listed: boolean) {
  const focus = useStore((s) => s.agentSettings?.focus);
  const clearFocus = useStore((s) => s.clearAgentSettingsFocus);
  useEffect(() => {
    if (focus !== AGENT_LIMITS_ID) return;
    if (listed)
      document
        .getElementById(AGENT_LIMITS_ID)
        ?.scrollIntoView({ block: "center" });
    clearFocus();
  }, [focus, listed, clearFocus]);
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
  const awaiting = status.spent.reduce(
    (sum, total) => sum + total.awaitingCalls,
    0,
  );
  const text = [
    others.length > 0 ? alsoSpent(others) : null,
    estimated > 0 ? callsAreEstimates(estimated, awaiting) : null,
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
