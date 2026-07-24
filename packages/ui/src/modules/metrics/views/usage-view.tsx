import { ChevronLeft, ChevronRight } from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SectionLabel } from "@/components/ui/section-label";

import { useAgentSpend, useModelSpend } from "../api/queries.js";
import {
  AgentSpendBars,
  ModelSpendTable,
} from "../components/metrics-panel.js";
import { formatUsd } from "../lib/format.js";

// Month boundaries are computed in the browser's timezone; the API takes the
// resulting instants, so "calendar month" means the user's wall-clock month.
const monthStart = (base: Date, offset: number) =>
  new Date(base.getFullYear(), base.getMonth() + offset, 1);

/** Settings tab: the user's LLM API spend for one calendar month, totalled
 *  and broken down per model across all their agents. */
export function UsageView() {
  const [month, setMonth] = useState(() => monthStart(new Date(), 0));
  const isCurrentMonth = month >= monthStart(new Date(), 0);
  const monthLabel = month.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  const from = month.toISOString();
  const to = monthStart(month, 1).toISOString();
  const { data, isPending, isError } = useModelSpend(from, to);
  const { data: agentData } = useAgentSpend(from, to);
  const total = data?.reduce((sum, row) => sum + row.costUsd, 0) ?? 0;

  return (
    <div>
      <PageHeader
        title="Usage"
        description="LLM API spend across all supported agents (currently only Claude Code and derivatives)."
        actions={
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous month"
              onClick={() => setMonth(monthStart(month, -1))}
            >
              <ChevronLeft size={16} />
            </Button>
            <span className="min-w-[120px] text-center text-[14px] font-medium">
              {monthLabel}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next month"
              disabled={isCurrentMonth}
              onClick={() => setMonth(monthStart(month, 1))}
            >
              <ChevronRight size={16} />
            </Button>
          </div>
        }
      />

      {isError && (
        <p className="text-[14px] text-muted-foreground">
          Usage metrics are unavailable on this deployment.
        </p>
      )}
      {isPending && !isError && (
        <p className="text-[14px] text-muted-foreground">Loading usage…</p>
      )}
      {data && (
        <>
          <SectionLabel spaced>Total spend</SectionLabel>
          <div className="mb-8 text-[32px] font-semibold tabular-nums text-foreground">
            {formatUsd(total)}
          </div>
          <SectionLabel spaced>Spend by model</SectionLabel>
          {data.length === 0 ? (
            <p className="text-[14px] text-muted-foreground">
              No LLM calls in {monthLabel}.
            </p>
          ) : (
            <Card className="p-4 text-[12px]">
              <ModelSpendTable rows={data} />
            </Card>
          )}
          {agentData && agentData.length > 0 && (
            <>
              <SectionLabel spaced>Spend by agent</SectionLabel>
              <Card className="p-4">
                <AgentSpendBars rows={agentData} />
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
