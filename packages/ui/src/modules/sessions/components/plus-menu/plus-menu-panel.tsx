import { ArrowLeft } from "@carbon/icons-react";
import type { ReactNode } from "react";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The frame of a second-level panel of the
 * composer's + menu: Back to the first level, the panel's title, Manage, which
 * opens the matching section of the Agent's settings, a scrolling list, and a
 * footer with the panel's add and describe actions.
 */
export function PlusMenuPanelFrame({
  title,
  onBack,
  onManage,
  footer,
  children,
}: {
  title: string;
  onBack: () => void;
  onManage?: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="plus-menu-panel">
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-background px-3 py-2.5">
        <button
          type="button"
          onClick={onBack}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Back"
        >
          <ArrowLeft size={16} />
        </button>
        <h2 className="flex-1 text-sm font-semibold text-foreground">
          {title}
        </h2>
        {onManage && (
          <button
            type="button"
            onClick={onManage}
            className="text-sm text-accent transition-colors hover:text-accent/80"
          >
            Manage
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">{children}</div>
      {footer && (
        <div className="flex shrink-0 items-center justify-between border-t border-border bg-background px-3 py-2.5">
          {footer}
        </div>
      )}
    </div>
  );
}

export function PlusMenuGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 py-2">
      <h3 className="text-xs font-medium text-muted-foreground">{label}</h3>
      {children}
    </section>
  );
}

export function PlusMenuNote({ children }: { children: ReactNode }) {
  return (
    <p className="py-3 text-center text-sm text-muted-foreground">{children}</p>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the panel's "Or, describe to create", the way to
 * ask the Agent to make one, as the design draws it: plain text, no icon, not
 * a link, in gray beside the outlined add, as the designer asked.
 */
export function DescribeButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      Or, describe to create
    </button>
  );
}
