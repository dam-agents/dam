import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
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
  action?: ReactNode;
  resetsAt?: string;
  children: ReactNode;
}

export function DailyLimitCard({ help, action, resetsAt, children }: Props) {
  return (
    <Card className="mb-6 flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {DAILY_LIMIT_TITLE}
          {help && <HelpTip content={help} />}
        </p>
        {action}
      </div>
      {children}
      {resetsAt && (
        <p className="text-xs text-muted-foreground">
          {resetsAtLine(localResetTime(resetsAt))}
        </p>
      )}
    </Card>
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
