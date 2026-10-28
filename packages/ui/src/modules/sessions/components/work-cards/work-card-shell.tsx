import { ChevronRight } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface WorkCardShellProps {
  icon: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  accessory?: ReactNode;
  trailingIcon?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

export function WorkCardShell({
  icon,
  title,
  detail,
  accessory,
  trailingIcon,
  selected,
  disabled,
  onClick,
}: WorkCardShellProps) {
  const interactive = !!onClick && !disabled;
  const trailing = trailingIcon ?? <ChevronRight size={16} />;
  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? onClick : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={cn(
        "group/card not-prose relative flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
        selected ? "border-foreground" : "border-border",
        disabled
          ? "cursor-not-allowed bg-muted opacity-60"
          : interactive
            ? "cursor-pointer bg-card hover:bg-muted/40"
            : "cursor-default bg-card",
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 truncate font-medium text-foreground">
            {title}
          </span>
          {accessory && <span className="ml-auto shrink-0">{accessory}</span>}
          {interactive && (
            <span
              className={cn(
                "shrink-0 text-foreground transition-colors",
                !accessory && "ml-auto",
              )}
            >
              {trailing}
            </span>
          )}
        </span>
        {detail && (
          <span className="block truncate text-xs text-muted-foreground">
            {detail}
          </span>
        )}
      </span>
    </div>
  );
}
