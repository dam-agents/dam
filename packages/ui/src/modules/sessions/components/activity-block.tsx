import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { Caret } from "./caret";

/** Left-bordered agent-activity row in the chat thread (thinking, tool runs):
 *  a label line plus optional collapsible detail. */
export function ActivityBlock({
  label,
  onToggle,
  open,
  className,
  children,
}: {
  label: ReactNode;
  /** Omit when there is no detail to expand — the label renders inert. */
  onToggle?: () => void;
  open?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "border-l-2 border-border-light pl-3 max-w-full text-[14px] font-normal text-muted-foreground",
        className,
      )}
    >
      <button
        type="button"
        className={cn(
          "flex items-center gap-1.5 max-w-full min-w-0 min-h-[27px]",
          onToggle
            ? "cursor-pointer hover:text-text transition-colors"
            : "cursor-default",
        )}
        onClick={onToggle}
      >
        {onToggle && (
          <Caret
            className={cn("transition-transform", !open && "-rotate-90")}
          />
        )}
        {label}
      </button>
      {open && children && <div className="mt-1">{children}</div>}
    </div>
  );
}
