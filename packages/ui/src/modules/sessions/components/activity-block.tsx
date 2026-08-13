import type { ReactNode } from "react";

import { DisclosureChevron } from "@/components/ui/disclosure";
import { cn } from "@/lib/utils";

export function ActivityBlock({
  label,
  onToggle,
  open,
  className,
  children,
}: {
  label: ReactNode;
  onToggle?: () => void;
  open?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "border-l-2 border-border pl-3 max-w-full text-sm font-normal text-muted-foreground",
        className,
      )}
    >
      <button
        type="button"
        className={cn(
          "flex items-center gap-1.5 max-w-full min-w-0 min-h-[27px]",
          onToggle
            ? "cursor-pointer hover:text-foreground transition-colors"
            : "cursor-default",
        )}
        onClick={onToggle}
      >
        {onToggle && <DisclosureChevron open={open ?? false} size={12} />}
        {label}
      </button>
      {open && children && <div className="mt-1">{children}</div>}
    </div>
  );
}
