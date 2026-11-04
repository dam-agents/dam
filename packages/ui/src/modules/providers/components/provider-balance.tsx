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
  const bob = balance.unit === "bobcoins";
  const unit = bob ? " Bc" : "";
  const used = formatAmount(balance, balance.used);
  const usage =
    balance.limit === null
      ? `${used}${unit}`
      : `${used} of ${formatAmount(balance, balance.limit)}${unit}`;
  const text = bob ? `${usage} this month` : `${usage} used`;
  return balance.limit !== null && balance.used >= balance.limit
    ? `Budget used up: ${text}`
    : text;
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
  const reset =
    balance.unit === "bobcoins" ? null : resetLabel(balance.resetsAt);
  const label = [summary(balance), reset].filter(Boolean).join(" · ");

  return (
    <span
      className={cn(
        "block shrink-0 truncate rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground",
        exhausted && "text-danger",
      )}
      title={label}
    >
      {label}
    </span>
  );
}
