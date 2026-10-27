import type { SpendLimitScope, SpendUnit } from "api-server-api";
import { useState } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { badgeSpend, badgeSpendTip } from "../lib/copy.js";
import { useConnectionSpendLimit } from "./connection-spend-limit.js";
import {
  type LimitComparison,
  SpendLimitDialog,
} from "./spend-limit-dialog.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: one provider's spend for an agent, as a badge on
 * its row rather than a line under it.
 */
export function ProviderSpendBadge({
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
  const spend = useConnectionSpendLimit({
    agentId,
    connectionId,
    connectionName,
    templateId,
  });
  if (!spend) return null;
  return (
    <SpendPill
      spentMicros={spend.spentMicros}
      amountMicros={spend.view.current?.amountMicros ?? null}
      unit={spend.rule.unit}
      scope={{ kind: "connection", agentId, connectionId }}
      subject={spend.subject}
      compare={spend.compare}
    />
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: what a provider spent today of its daily limit,
 * as a pill that opens the limit dialog, with a tooltip that says when the
 * amount is only a subscription's worth for comparison. A provider row shows
 * one: an agent's, or the owner's across all agents in Settings.
 */
export function SpendPill({
  spentMicros,
  amountMicros,
  unit,
  scope,
  subject,
  compare,
}: {
  spentMicros: number;
  amountMicros: number | null;
  unit: SpendUnit;
  scope: SpendLimitScope;
  subject: string;
  compare?: LimitComparison;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tooltip content={badgeSpendTip(unit, amountMicros !== null)}>
        <button
          type="button"
          data-testid="provider-spend-badge"
          onClick={() => setOpen(true)}
          className={cn(
            "shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground",
            "transition-colors hover:bg-muted/60 hover:text-foreground",
            "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
          )}
        >
          {badgeSpend(spentMicros, amountMicros, unit)}
        </button>
      </Tooltip>
      {open && (
        <SpendLimitDialog
          scope={scope}
          unit={unit}
          subject={subject}
          amountMicros={amountMicros}
          {...(compare && { compare })}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
