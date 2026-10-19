import { Add } from "@carbon/icons-react";
import { Children, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionLabel } from "@/components/ui/section-label";
import { TextSkeleton } from "@/components/ui/text-skeleton";
import { cn } from "@/lib/utils";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The one layout for every "manage a list of
 * things" block: a label above a rounded card whose rows are split by
 * dividers. Adding a row is itself a row: addRow sits below the card, in the
 * same shape as the page's own rows, and an empty list shows its empty text
 * with the same action button inside the card instead. Adding and editing
 * happen in a modal the caller opens from onNew.
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
  addRow,
  isEmpty,
  error,
  loading = false,
  footer,
  separated = false,
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
  addRow?: ReactNode;
  isEmpty: boolean;
  error?: ReactNode;
  loading?: boolean;
  footer?: ReactNode;
  separated?: boolean;
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
      {(label || headerExtra) && (
        <SectionHeader label={label}>{headerExtra}</SectionHeader>
      )}
      {description && (
        <p className="mb-3 text-sm text-muted-foreground">{description}</p>
      )}
      {separated && !loading && !isEmpty ? (
        <div className="flex flex-col gap-3">
          {Children.map(children, (child) => (
            <Card className="overflow-hidden">{child}</Card>
          ))}
          {footer}
        </div>
      ) : (
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
            <p
              role="alert"
              className="px-5 py-8 text-center text-sm text-danger"
            >
              {error}
            </p>
          ) : isEmpty ? (
            <EmptyState bordered={false} action={newButton(newTestId)}>
              {empty}
            </EmptyState>
          ) : (
            <div className="divide-y divide-border">{children}</div>
          )}
          {footer}
        </Card>
      )}
      {addRow && !loading && !isEmpty && (
        <Card className="mt-3 overflow-hidden">{addRow}</Card>
      )}
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

/**
 * UNIT_BOUNDARY_DESCRIPTION: The row that stands in for a list's missing
 * entries: it reads as one more row of the card and opens the caller's create
 * flow. Its children carry the page's own row anatomy, so an add row looks
 * like the rows it sits under.
 */
export function AddRow({
  onClick,
  disabled,
  testId,
  className,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={cn(
        LIST_ROW,
        "w-full text-left text-muted-foreground transition-colors hover:bg-muted/40 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}
