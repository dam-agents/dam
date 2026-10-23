import type { UserBudgetDefaults, UserBudgetEntry } from "api-server-api";

import { cn } from "@/lib/utils";

import { OperatorEntryRow } from "../../operator/components/operator-entry-row.js";
import { cpuText, reservedLine } from "../lib/user-budget-copy.js";

interface Props {
  entry: UserBudgetEntry;
  defaults: UserBudgetDefaults;
  onChange: (entry: UserBudgetEntry) => void;
  onRemove: (entry: UserBudgetEntry) => void;
  removing: boolean;
}

function Size({
  own,
  fallback,
  unit,
}: {
  own: string | null;
  fallback: string;
  unit: string;
}) {
  return (
    <span className={cn(own === null && "text-muted-foreground")}>
      {own ?? fallback} {unit}
      {own === null && " (default)"}
    </span>
  );
}

export function UserBudgetRow({
  entry,
  defaults,
  onChange,
  onRemove,
  removing,
}: Props) {
  const user = entry.email ?? entry.ownerSub;
  const storageFallback = defaults.storage;
  return (
    <OperatorEntryRow
      user={user}
      ownerSub={entry.ownerSub}
      setBy={{
        email: entry.setByEmail,
        sub: entry.setBySub,
        at: entry.updatedAt,
      }}
      note={reservedLine(entry)}
      values={
        <>
          {entry.cpu === null ? (
            <span className="text-muted-foreground">
              {cpuText(defaults.cpu)} (default)
            </span>
          ) : (
            <span>{cpuText(entry.cpu)}</span>
          )}
          <Size own={entry.memory} fallback={defaults.memory} unit="memory" />
          {(entry.storage !== null || storageFallback !== null) && (
            <Size
              own={entry.storage}
              fallback={storageFallback ?? ""}
              unit="storage"
            />
          )}
        </>
      }
      changeLabel={`Change the compute budget of ${user}`}
      removeLabel={`Remove the compute budget of ${user}`}
      onChange={() => onChange(entry)}
      onRemove={() => onRemove(entry)}
      removing={removing}
    />
  );
}
