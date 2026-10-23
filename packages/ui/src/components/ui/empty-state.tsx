import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The one empty state for a list or a page section:
 * a bordered card with a centred muted message, an optional title above it and
 * an optional action below it. ListSection uses it, so a section that is not a
 * list still shows the same box as one that is.
 */
export function EmptyState({
  title,
  children,
  action,
  bordered = true,
  className,
}: {
  title?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  bordered?: boolean;
  className?: string;
}) {
  const body = (
    <div
      className={cn(
        "flex flex-col items-center gap-4 px-5 py-8 text-center",
        !bordered && className,
      )}
    >
      <div className="flex flex-col gap-1">
        {title && (
          <p className="text-sm font-medium text-foreground">{title}</p>
        )}
        <div className="text-sm text-muted-foreground">{children}</div>
      </div>
      {action}
    </div>
  );
  return bordered ? (
    <Card className={cn("overflow-hidden", className)}>{body}</Card>
  ) : (
    body
  );
}
