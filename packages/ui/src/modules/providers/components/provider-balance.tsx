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
      <p className="truncate text-xs text-muted-foreground">
        Balance unavailable
      </p>
    );
  }
  if (!balance) return null;

  const exhausted = balance.limit !== null && balance.used >= balance.limit;
  const reset = resetLabel(balance.resetsAt);
  const label = [summary(balance), reset].filter(Boolean).join(" · ");

  return (
    <p
      className={cn(
        "truncate text-xs",
        exhausted ? "text-danger" : "text-muted-foreground",
      )}
      title={label}
    >
      {label}
    </p>
  );
}
