import { Launch, Time } from "@carbon/icons-react";
import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { clockLabel, formatTimestamp } from "@/lib/format-time";
import { cn } from "@/lib/utils";

const RUNNING_BADGE =
  "shrink-0 cursor-pointer gap-1.5 border-kit-line bg-kit-surface text-kit";

export function kitUpdatingLabel(version: string): string {
  return `Kit updating to ${version}`;
}

export function KitUpdatingBadgeFace({
  version,
  className,
  ...props
}: { version: string } & ComponentProps<"button">) {
  return (
    <Badge variant="outline" className={cn(RUNNING_BADGE, className)} asChild>
      <button
        type="button"
        aria-label={kitUpdatingLabel(version)}
        data-testid="agent-kit-updating-badge"
        {...props}
      >
        <Spinner size={12} className="text-kit" />
        Kit updating
      </button>
    </Badge>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the panel a running Kit Update's tile badge
 * opens, as the approved design draws it: the versions it moves between, the
 * clock time the owner started it, "Continue update" into the update's chat,
 * and "See what changed", the same compare page as the update bar's card.
 */
export function KitUpdatingPanel({
  from,
  to,
  startedAt,
  compareUrl,
  onContinue,
}: {
  from: string;
  to: string;
  startedAt: string;
  compareUrl: string | null;
  onContinue: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 text-sm" data-testid="kit-updating">
      <p className="font-bold text-foreground">Kit update in progress</p>
      <p className="text-muted-foreground">
        From {from} to {to}, in its chat — it can wait while it asks you
        something.
      </p>
      <p className="flex items-center gap-1.5 text-muted-foreground">
        <Time size={14} aria-hidden />
        <time dateTime={startedAt} title={formatTimestamp(startedAt)}>
          Started at {clockLabel(startedAt)}
        </time>
      </p>
      <div className="mt-1 flex items-center gap-3">
        <Button size="sm" onClick={onContinue}>
          Continue update
        </Button>
        {compareUrl && (
          <a
            href={compareUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 whitespace-nowrap text-accent hover:underline"
          >
            See what changed <Launch size={12} aria-hidden />
          </a>
        )}
      </div>
    </div>
  );
}
