import type { ReactNode } from "react";

import { DisclosureChevron } from "@/components/ui/disclosure";
import { cn } from "@/lib/utils";

export function ActivityBlock({
  label,
  onToggle,
  open,
  actions,
  className,
  children,
}: {
  label: ReactNode;
  onToggle?: () => void;
  open?: boolean;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "border-l-2 border-border pl-3 max-w-full text-sm font-normal text-muted-foreground group",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2 max-w-full min-w-0 min-h-[27px]">
        <button
          type="button"
          aria-expanded={onToggle ? (open ?? false) : undefined}
          className={cn(
            "flex items-start gap-1.5 min-w-0 flex-1 py-0.5 text-left",
            onToggle
              ? "cursor-pointer hover:text-foreground transition-colors"
              : "cursor-default",
          )}
          onClick={onToggle}
        >
          {onToggle && (
            <DisclosureChevron
              open={open ?? false}
              size={12}
              className="mt-1 shrink-0"
            />
          )}
          {label}
        </button>
        {actions && (
          <div className="shrink-0 flex items-center self-start">{actions}</div>
        )}
      </div>
      {open && children && <div className="mt-1">{children}</div>}
    </div>
  );
}
