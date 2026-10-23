import { User } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { LIST_ROW } from "@/components/ui/list-section";
import { RemoveButton } from "@/components/ui/remove-button";
import { cn } from "@/lib/utils";

import { formatRunTime } from "../../schedules/lib/schedule-format.js";

interface Props {
  user: string;
  ownerSub: string;
  setBy: { email: string | null; sub: string | null; at: string | null };
  note?: ReactNode;
  values: ReactNode;
  changeLabel: string;
  removeLabel: string;
  onChange: () => void;
  onRemove: () => void;
  removing: boolean;
}

export function OperatorEntryRow({
  user,
  ownerSub,
  setBy,
  note,
  values,
  changeLabel,
  removeLabel,
  onChange,
  onRemove,
  removing,
}: Props) {
  return (
    <div className={cn(LIST_ROW, "items-start")}>
      <User size={20} className="text-muted-foreground mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <span
          className="block truncate text-md font-medium text-foreground"
          title={ownerSub}
        >
          {user}
        </span>
        <div className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-sm text-foreground">
          {values}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {note && <>{note} · </>}
          {setBy.at === null
            ? "Set outside the platform"
            : `Set by ${setBy.email ?? setBy.sub} ${formatRunTime(setBy.at)}`}
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        aria-label={changeLabel}
        disabled={removing}
        onClick={onChange}
      >
        Change
      </Button>
      <RemoveButton
        label={removeLabel}
        tooltip="Remove"
        onClick={onRemove}
        disabled={removing}
      />
    </div>
  );
}
