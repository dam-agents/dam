import type { SpendStatus, SpendUnit } from "api-server-api";

import { Card } from "@/components/ui/card";
import { TextSkeleton } from "@/components/ui/text-skeleton";

import { useRootDriver } from "../../agents/hooks/use-root-driver.js";
import { useProviderConnections } from "../../sessions/api/session-pair.js";
import { useAgentSpendStatus } from "../api/queries.js";
import { agentLimitOf } from "../lib/agent-limit.js";
import {
  AGENT_LIMIT_NAME,
  CEILING_NAME,
  measuredSpendHelp,
  OWN_LIMIT_NAME,
} from "../lib/copy.js";
import { agentLimitCoverage } from "../lib/coverage.js";
import {
  bareSpend,
  formatSpend,
  localResetTime,
  UNIT_EXPLANATIONS,
} from "../lib/format.js";
import { nearerOwnerWideLimit } from "../lib/nearer-limit.js";
import { AgentLimitCoverageNote } from "./agent-limit-coverage-note.js";
import { HelpTip } from "./help-tip.js";
import { RootDriverSpendNote } from "./root-driver-spend-note.js";
import { SpendLimitField } from "./spend-limit-field.js";
import { SpendLimitMeter } from "./spend-limit-meter.js";

const NEARER_NAMES = {
  owner: OWN_LIMIT_NAME,
  ceiling: CEILING_NAME,
} as const;

const PRIMARY_CAPTIONS: Readonly<Record<SpendUnit, string>> = {
  usd: "Paid API spend today.",
  usd_list: "Subscription value today.",
  bobcoin: "Bobcoins today.",
  free: "Paid API spend today.",
};

function spentCaption(status: SpendStatus, primary: SpendUnit): string {
  const others = status.spent
    .filter((total) => total.unit !== primary && total.costMicros > 0)
    .map((total) => formatSpend(total.costMicros, total.unit));
  const estimated = status.spent.reduce(
    (sum, total) => sum + total.estimatedCalls,
    0,
  );
  return [
    PRIMARY_CAPTIONS[primary],
    others.length > 0 ? `Also ${others.join(" and ")}.` : null,
    estimated > 0
      ? `${String(estimated)} ${estimated === 1 ? "call is" : "calls are"} estimated.`
      : null,
    `Resets at ${localResetTime(status.resetsAt)} your time.`,
  ]
    .filter(Boolean)
    .join(" ");
}

function spendHelp(status: SpendStatus | undefined): string {
  const units = new Set(status?.spent.map((total) => total.unit) ?? []);
  return [
    measuredSpendHelp(),
    ...[...units].flatMap((unit) => UNIT_EXPLANATIONS[unit] ?? []),
  ].join(" ");
}

export function AgentSpendLimitCard({ agentId }: { agentId: string }) {
  const root = useRootDriver(agentId);
  const { data: status, isError } = useAgentSpendStatus(
    root === null ? agentId : null,
  );

  return (
    <Card className="mb-6 p-4">
      <p className="mb-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
        Spend today
        <HelpTip content={spendHelp(status)} />
      </p>
      {root ? (
        <RootDriverSpendNote root={root} />
      ) : isError ? (
        <p className="text-sm text-muted-foreground">
          Couldn't load today's spend.
        </p>
      ) : status ? (
        <AgentSpendLimitBody agentId={agentId} status={status} />
      ) : (
        <TextSkeleton width={96} />
      )}
    </Card>
  );
}

function AgentSpendLimitBody({
  agentId,
  status,
}: {
  agentId: string;
  status: SpendStatus;
}) {
  const { granted, loaded } = useProviderConnections(agentId);
  const coverage = agentLimitCoverage(granted.map((p) => p.templateId));
  const primary: SpendUnit =
    coverage.paid || !loaded ? "usd" : (coverage.uncountedUnits[0] ?? "usd");
  const primaryMicros =
    status.spent.find((total) => total.unit === primary)?.costMicros ?? 0;
  const limit = agentLimitOf(status, agentId);
  const showField = coverage.paid || limit !== undefined;
  const nearer = coverage.paid ? nearerOwnerWideLimit(status, agentId) : null;

  return (
    <>
      <p className="font-mono text-2xl font-semibold leading-none tracking-[-0.02em] tabular-nums text-foreground">
        {bareSpend(primaryMicros, primary)}
      </p>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {spentCaption(status, primary)}
      </p>
      <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
        {showField && (
          <SpendLimitField
            label={AGENT_LIMIT_NAME}
            scope={{ kind: "agent", agentId }}
            unit="usd"
            amountMicros={limit?.amountMicros ?? null}
          />
        )}
        {coverage.paid && limit && (
          <SpendLimitMeter
            label={AGENT_LIMIT_NAME}
            unit="usd"
            spentMicros={limit.spentMicros}
            limitMicros={limit.effectiveMicros}
            state={limit.state}
            extensions={limit.extensions}
          />
        )}
        {loaded && (
          <AgentLimitCoverageNote
            agentId={agentId}
            coverage={coverage}
            hasLimit={limit !== undefined}
          />
        )}
        {nearer && (
          <p className="text-sm text-muted-foreground">
            {NEARER_NAMES[nearer.kind]} has only{" "}
            {formatSpend(nearer.leftMicros, "usd")} left today, so it stops this
            agent first.
          </p>
        )}
      </div>
    </>
  );
}
