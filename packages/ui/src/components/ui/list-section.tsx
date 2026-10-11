import { Add } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The one layout for every "manage a list of
 * things" block: a label with a "+ New" button above a rounded card whose rows
 * are split by dividers. An empty list shows its empty text in the card, with
 * the same "+ New" button inside it. Adding and editing happen in a modal the
 * caller opens from onNew.
 */
export function ListSection({
  label,
  description,
  onNew,
  newLabel = "New",
  newTestId,
  newDisabled,
  headerExtra,
  empty,
  isEmpty,
  footer,
  className,
  children,
}: {
  label?: ReactNode;
  description?: ReactNode;
  onNew?: () => void;
  newLabel?: string;
  newTestId?: string;
  newDisabled?: boolean;
  headerExtra?: ReactNode;
  empty: ReactNode;
  isEmpty: boolean;
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const newButton = (testId?: string) =>
    onNew && (
      <Button
        variant="outline"
        size="sm"
        onClick={onNew}
        disabled={newDisabled}
        data-testid={testId}
      >
        <Add size={16} />
        {newLabel}
      </Button>
    );
  return (
    <section className={cn("mb-8", className)}>
      {(label || headerExtra || (onNew && !isEmpty)) && (
        <div className="mb-3 flex min-h-8 items-center justify-between gap-3">
          {label && <SectionLabel>{label}</SectionLabel>}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {headerExtra}
            {!isEmpty && newButton(newTestId)}
          </div>
        </div>
      )}
      {description && (
        <p className="mb-3 text-sm text-muted-foreground">{description}</p>
      )}
      <Card className="overflow-hidden">
        {isEmpty ? (
          <div className="flex flex-col items-center gap-4 px-5 py-8 text-center">
            <div className="text-sm text-muted-foreground">{empty}</div>
            {newButton(newTestId)}
          </div>
        ) : (
          <div className="divide-y divide-border">{children}</div>
        )}
        {footer}
      </Card>
    </section>
  );
}

export const LIST_ROW = "flex items-center gap-3 px-4 py-3";
