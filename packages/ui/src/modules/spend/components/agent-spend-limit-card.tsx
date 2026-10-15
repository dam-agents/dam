import type { SpendStatus } from "api-server-api";

import { Card } from "@/components/ui/card";
import { TextSkeleton } from "@/components/ui/text-skeleton";

import { useAgentsList } from "../../agents/api/queries.js";
import { rootDriverOf } from "../../agents/lib/root-driver.js";
import { useAgentSpendStatus } from "../api/queries.js";
import { formatSpend } from "../lib/format.js";
import { nearerOwnerWideLimit } from "../lib/nearer-limit.js";
import { RootDriverSpendNote } from "./root-driver-spend-note.js";
import { SpendLimitField } from "./spend-limit-field.js";
import { SpendLimitMeter } from "./spend-limit-meter.js";

const NEARER_TEXT = {
  owner: "Your own daily limit stops this agent first",
  ceiling: "Your daily spend ceiling stops this agent first",
} as const;

function resetTime(resetsAt: string): string {
  return new Date(resetsAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function spentCaption(status: SpendStatus): string {
  const others = status.spent
    .filter((total) => total.unit !== "usd" && total.costMicros > 0)
    .map((total) => formatSpend(total.costMicros, total.unit));
  const estimated = status.spent.reduce(
    (sum, total) => sum + total.estimatedCalls,
    0,
  );
  return [
    "Metered today.",
    others.length > 0 ? `Also ${others.join(" and ")}.` : null,
    estimated > 0
      ? `${String(estimated)} ${estimated === 1 ? "call" : "calls"} estimated.`
      : null,
    `Resets at ${resetTime(status.resetsAt)} (midnight UTC).`,
  ]
    .filter(Boolean)
    .join(" ");
}

export function AgentSpendLimitCard({ agentId }: { agentId: string }) {
  const root = rootDriverOf(agentId, useAgentsList());
  const { data: status, isError } = useAgentSpendStatus(root ? null : agentId);

  return (
    <Card className="mb-6 p-4">
      <p className="mb-1.5 text-sm text-muted-foreground">Daily spend limit</p>
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
  const usd = status.spent.find((total) => total.unit === "usd");
  const limit = status.limits.find(
    (view) => view.scope.kind === "agent" && view.scope.agentId === agentId,
  );
  const nearer = nearerOwnerWideLimit(status, agentId);

  return (
    <>
      <p className="font-mono text-2xl font-semibold leading-none tracking-[-0.02em] tabular-nums text-foreground">
        {formatSpend(usd?.costMicros ?? 0, "usd")}
      </p>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {spentCaption(status)}
      </p>
      <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
        <SpendLimitField
          label="Daily limit"
          scope={{ kind: "agent", agentId }}
          unit="usd"
          amountMicros={limit?.amountMicros ?? null}
        />
        {limit && (
          <SpendLimitMeter
            label="Daily limit"
            unit="usd"
            spentMicros={limit.spentMicros}
            limitMicros={limit.effectiveMicros}
            state={limit.state}
            extensions={limit.extensions}
          />
        )}
        {nearer && (
          <p className="text-sm text-muted-foreground">
            {NEARER_TEXT[nearer.kind]}: {formatSpend(nearer.leftMicros, "usd")}{" "}
            left today.
          </p>
        )}
      </div>
    </>
  );
}
