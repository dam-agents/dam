import { Add } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

interface Props {
  message: string;
  actionLabel: string;
  onAction: () => void;
  actionTestId?: string;
}

export function EmptyStateCard({
  message,
  actionLabel,
  onAction,
  actionTestId,
}: Props) {
  return (
    <Callout inset className="bg-card">
      <div className="flex flex-col items-center gap-4 py-6">
        <p className="text-sm text-foreground/80">{message}</p>
        <Button variant="outline" onClick={onAction} data-testid={actionTestId}>
          <Add size={16} />
          {actionLabel}
        </Button>
      </div>
    </Callout>
  );
}
