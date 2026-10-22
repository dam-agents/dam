import { User } from "@carbon/icons-react";
import type { SpendCeilingEntry } from "api-server-api";

import { Button } from "@/components/ui/button";
import { LIST_ROW } from "@/components/ui/list-section";
import { RemoveButton } from "@/components/ui/remove-button";
import { cn } from "@/lib/utils";

import { formatRunTime } from "../../schedules/lib/schedule-format.js";
import { ceilingPerDay } from "../lib/copy.js";

interface Props {
  entry: SpendCeilingEntry;
  onChange: (entry: SpendCeilingEntry) => void;
  onRemove: (entry: SpendCeilingEntry) => void;
  removing: boolean;
}

export function SpendCeilingRow({
  entry,
  onChange,
  onRemove,
  removing,
}: Props) {
  const user = entry.email ?? entry.ownerSub;
  return (
    <div className={cn(LIST_ROW, "items-start")}>
      <User size={20} className="text-muted-foreground mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span
            className="truncate text-md font-medium text-foreground"
            title={entry.ownerSub}
          >
            {user}
          </span>
          <span className="shrink-0 font-mono text-sm text-foreground">
            {ceilingPerDay(entry.amountMicros)}
          </span>
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          Set by {entry.setByEmail ?? entry.setBySub}{" "}
          {formatRunTime(entry.updatedAt)}
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        aria-label={`Change the spend ceiling of ${user}`}
        disabled={removing}
        onClick={() => onChange(entry)}
      >
        Change
      </Button>
      <RemoveButton
        label={`Remove the spend ceiling of ${user}`}
        tooltip="Remove"
        onClick={() => onRemove(entry)}
        disabled={removing}
      />
    </div>
  );
}
