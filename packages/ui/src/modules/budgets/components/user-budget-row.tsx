import { User } from "@carbon/icons-react";
import type { UserBudgetDefaults, UserBudgetEntry } from "api-server-api";

import { Button } from "@/components/ui/button";
import { LIST_ROW } from "@/components/ui/list-section";
import { RemoveButton } from "@/components/ui/remove-button";
import { cn } from "@/lib/utils";

import { formatRunTime } from "../../schedules/lib/schedule-format.js";
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
    <div className={cn(LIST_ROW, "items-start")}>
      <User size={20} className="text-muted-foreground mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <span
          className="block truncate text-md font-medium text-foreground"
          title={entry.ownerSub}
        >
          {user}
        </span>
        <div className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-sm text-foreground">
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
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {reservedLine(entry)} ·{" "}
          {entry.updatedAt === null
            ? "Set outside the platform"
            : `Set by ${entry.setByEmail ?? entry.setBySub} ${formatRunTime(entry.updatedAt)}`}
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        aria-label={`Change the compute budget of ${user}`}
        disabled={removing}
        onClick={() => onChange(entry)}
      >
        Change
      </Button>
      <RemoveButton
        label={`Remove the compute budget of ${user}`}
        tooltip="Remove"
        onClick={() => onRemove(entry)}
        disabled={removing}
      />
    </div>
  );
}
