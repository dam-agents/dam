import { ArrowLeft } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

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
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Back"
          tooltip="Back"
          onClick={onBack}
        >
          <ArrowLeft size={16} />
        </Button>
        <h2 className="flex-1 text-sm font-semibold text-foreground">
          {title}
        </h2>
        {onManage && (
          <Button variant="link" size="inline" onClick={onManage}>
            Manage
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">{children}</div>
      {footer && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-3 py-2">
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

export function DescribeButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground"
      onClick={onClick}
    >
      Or, describe to create
    </Button>
  );
}
