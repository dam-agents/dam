import { useState } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { badgeSpend, badgeSpendTip } from "../lib/copy.js";
import { useConnectionSpendLimit } from "./connection-spend-limit.js";
import { SpendLimitDialog } from "./spend-limit-dialog.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: one provider's spend in the Services panel, as a
 * badge on its row rather than a line under it: what it spent today of its
 * daily limit, the same dialog as the page when clicked, and a tooltip that
 * says when the amount is only a subscription's worth for comparison.
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
  const [open, setOpen] = useState(false);
  if (!spend) return null;
  const unit = spend.rule.unit;
  const amountMicros = spend.view.current?.amountMicros ?? null;
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
          {badgeSpend(spend.spentMicros, amountMicros, unit)}
        </button>
      </Tooltip>
      {open && (
        <SpendLimitDialog
          scope={{ kind: "connection", agentId, connectionId }}
          unit={unit}
          subject={spend.subject}
          amountMicros={amountMicros}
          compare={spend.compare}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
