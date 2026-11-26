import type { ReactNode } from "react";

import { TextSkeleton } from "@/components/ui/text-skeleton";

import {
  DAILY_LIMIT_TITLE,
  resetsAtLine,
  SPEND_STATUS_ERROR,
} from "../lib/copy.js";
import { localResetTime } from "../lib/format.js";
import { HelpTip } from "./help-tip.js";

interface Props {
  help?: string;
  description?: string;
  action?: ReactNode;
  resetsAt?: string;
  list?: ReactNode;
  children: ReactNode;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the card of a daily spend limit on a Usage page:
 * its title and what it counts, the button that sets it, the limit's own
 * meter and when it resets, and under a divider the other limits that count
 * the same calls.
 */
export function DailyLimitCard({
  help,
  description,
  action,
  resetsAt,
  list,
  children,
}: Props) {
  return (
    <div className="mb-6 flex flex-col rounded-lg border border-border bg-card">
      <div className="flex items-start justify-between gap-4 p-6 pb-4">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            {DAILY_LIMIT_TITLE}
            {help && <HelpTip content={help} />}
          </p>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </div>
      <div className="flex flex-col gap-2 px-6 pb-5">
        {children}
        {resetsAt && (
          <p className="text-xs text-muted-foreground">
            {resetsAtLine(localResetTime(resetsAt))}
          </p>
        )}
      </div>
      {list && (
        <div className="border-t border-border px-6 py-4 empty:hidden">
          {list}
        </div>
      )}
    </div>
  );
}

export function DailyLimitCardPending({
  help,
  failed,
}: {
  help?: string;
  failed: boolean;
}) {
  return (
    <DailyLimitCard {...(help !== undefined && { help })}>
      {failed ? (
        <p className="text-sm text-muted-foreground">{SPEND_STATUS_ERROR}</p>
      ) : (
        <TextSkeleton width={160} />
      )}
    </DailyLimitCard>
  );
}
