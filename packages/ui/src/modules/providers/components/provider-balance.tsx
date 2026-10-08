import type { ProviderBalance as Balance } from "api-server-api";

import { cn } from "@/lib/utils";

import { useProviderBalance } from "../api/queries.js";

function formatAmount(balance: Balance, value: number): string {
  const amount = value.toLocaleString("en-US", {
    minimumFractionDigits: balance.unit === "usd" ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return balance.unit === "usd" ? `$${amount}` : amount;
}

function summary(balance: Balance): string {
  const unit = balance.unit === "bobcoins" ? " Bobcoins" : "";
  const used = formatAmount(balance, balance.used);
  if (balance.limit === null) return `${used}${unit} used`;
  const usage = `${used} of ${formatAmount(balance, balance.limit)}${unit}`;
  return balance.used >= balance.limit
    ? `Budget used up: ${usage}`
    : `${usage} used`;
}

function resetLabel(resetsAt: string | null): string | null {
  if (!resetsAt) return null;
  const date = new Date(resetsAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  return `resets ${date}`;
}

export function ProviderBalance({ connectionId }: { connectionId: string }) {
  const { data: balance, isError } = useProviderBalance(connectionId);

  if (isError) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">Balance unavailable</p>
    );
  }
  if (!balance) return null;

  const exhausted = balance.limit !== null && balance.used >= balance.limit;
  const usedShare =
    balance.limit && balance.limit > 0
      ? Math.min(balance.used / balance.limit, 1)
      : null;
  const reset = resetLabel(balance.resetsAt);

  return (
    <div className="mt-2 flex max-w-sm flex-col gap-1">
      {usedShare !== null && (
        <div
          className="h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Budget used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(usedShare * 100)}
        >
          <div
            className={cn(
              "h-full rounded-full",
              exhausted ? "bg-danger" : "bg-primary",
            )}
            style={{ width: `${usedShare * 100}%` }}
          />
        </div>
      )}
      <p
        className={cn(
          "text-xs",
          exhausted ? "text-danger" : "text-muted-foreground",
        )}
      >
        {summary(balance)}
        {reset && ` · ${reset}`}
      </p>
    </div>
  );
}
