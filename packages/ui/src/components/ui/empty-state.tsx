import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
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

/**
 * UNIT_BOUNDARY_DESCRIPTION: the one line a panel shows while it loads, when it holds nothing, or when its load failed: centred above nothing else, muted, or in the danger colour when it reports the failure. A panel with no title or action shows it instead of EmptyState, so no panel writes its own bare paragraph.
 */
export function PanelMessage({
  tone = "muted",
  className,
  children,
}: {
  tone?: "muted" | "danger";
  className?: string;
  children: ReactNode;
}) {
  return (
    <p
      className={cn(
        "py-6 text-center text-sm",
        tone === "danger" ? "text-danger" : "text-muted-foreground",
        className,
      )}
    >
      {children}
    </p>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a panel whose load failed: the muted sentence that says what did not load, and the button that tries again. `action` adds the other way out beside Retry.
 */
export function LoadFailed({
  what,
  onRetry,
  action,
}: {
  what: ReactNode;
  onRetry: () => void;
  action?: ReactNode;
}) {
  return (
    <EmptyState
      bordered={false}
      action={
        <div className="flex items-center gap-2">
          {action}
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      }
    >
      {what}
    </EmptyState>
  );
}
