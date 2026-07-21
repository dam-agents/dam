import { Add } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { Inset } from "@/components/ui/inset";

interface Props {
  message: string;
  actionLabel: string;
  onAction: () => void;
  actionTestId?: string;
}

/** The empty state for a sandbox section: a bordered, gutter-aligned card with
 *  a message and a single "add" action. Shared by Connections, Schedules, and
 *  any section that starts empty. */
export function EmptyStateCard({
  message,
  actionLabel,
  onAction,
  actionTestId,
}: Props) {
  return (
    <Inset className="rounded-lg border border-border bg-card">
      <div className="flex flex-col items-center gap-4 py-10">
        <p className="text-[14px] text-foreground/80">{message}</p>
        <Button
          variant="outline"
          className="h-[40px] text-[14px]"
          onClick={onAction}
          data-testid={actionTestId}
        >
          <Add size={16} />
          {actionLabel}
        </Button>
      </div>
    </Inset>
  );
}
