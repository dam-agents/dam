import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";

import { useHarnessSpend } from "../api/harness-spend.js";
import { formatHarnessSpend } from "../lib/format.js";
import { monthLabel, monthRange } from "../lib/month-range.js";

function sessionsLabel(count: number): string {
  return count === 1 ? "1 session" : `${count} sessions`;
}

export function HarnessSpendCard({
  agentId,
  month,
}: {
  agentId: string;
  month: Date;
}) {
  const { from, to } = monthRange(month);
  const { data, isError, operable, reportsOwnSpend } = useHarnessSpend(
    agentId,
    from,
    to,
  );
  const label = monthLabel(month);

  if (!operable) {
    if (!reportsOwnSpend) return null;
    return (
      <HarnessSpendShell>
        <p className="text-sm text-muted-foreground">
          Start the agent to see what its harness spent in {label}.
        </p>
      </HarnessSpendShell>
    );
  }
  if (isError) {
    return (
      <HarnessSpendShell>
        <p className="text-sm text-muted-foreground">
          Couldn't read the harness spend for {label}.
        </p>
      </HarnessSpendShell>
    );
  }
  if (!data) return null;

  return (
    <HarnessSpendShell>
      <p className="font-mono text-xl font-semibold leading-none tracking-[-0.02em] tabular-nums text-foreground">
        {formatHarnessSpend(data)}
      </p>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {sessionsLabel(data.sessions)} started in {label}, as the harness
        reports it. Not part of the LLM spend below.
      </p>
    </HarnessSpendShell>
  );
}

function HarnessSpendShell({ children }: { children: ReactNode }) {
  return (
    <Card className="mb-6 p-4">
      <p className="mb-1.5 text-sm text-muted-foreground">Harness spend</p>
      {children}
    </Card>
  );
}
