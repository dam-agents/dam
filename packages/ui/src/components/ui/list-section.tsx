import { Add } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { TextSkeleton } from "@/components/ui/text-skeleton";
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
  error,
  loading = false,
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
  error?: ReactNode;
  loading?: boolean;
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
      {(label || headerExtra || (onNew && !isEmpty && !loading)) && (
        <SectionHeader label={label}>
          {headerExtra}
          {!isEmpty && !loading && newButton(newTestId)}
        </SectionHeader>
      )}
      {description && (
        <p className="mb-3 text-sm text-muted-foreground">{description}</p>
      )}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="divide-y divide-border" aria-busy="true">
            {[0, 1].map((i) => (
              <div key={i} className={LIST_ROW}>
                <span className="text-sm">
                  <TextSkeleton width={i === 0 ? 160 : 120} />
                </span>
              </div>
            ))}
          </div>
        ) : isEmpty && error ? (
          <p role="alert" className="px-5 py-8 text-center text-sm text-danger">
            {error}
          </p>
        ) : isEmpty ? (
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

/**
 * UNIT_BOUNDARY_DESCRIPTION: The row above a page section: its label on the
 * left and the section's actions on the right, at one fixed height so labels
 * line up whether or not a section has actions.
 */
export function SectionHeader({
  label,
  children,
}: {
  label?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-3 flex min-h-8 items-center justify-between gap-3">
      {label && <SectionLabel>{label}</SectionLabel>}
      <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

export const LIST_ROW = "flex items-center gap-3 px-4 py-3";
