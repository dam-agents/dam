import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

import { Caret } from "./caret";

// Height behavior (fixed / fill / collapsed) is driven by the parent via className/style.
export function SidebarSection({
  title,
  open,
  onToggle,
  headerLeft,
  headerRight,
  className,
  headerClassName,
  style,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  headerLeft?: ReactNode;
  headerRight?: ReactNode;
  className?: string;
  headerClassName?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("flex flex-col min-h-0 overflow-hidden", className)}
      style={style}
    >
      <div
        className={cn(
          "flex items-center gap-1 pl-3 pr-2 h-11 shrink-0 border-border-light",
          open && "border-b",
          headerClassName,
        )}
      >
        {headerLeft}
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2 min-w-0 flex-1 text-[14px] font-medium text-text transition-colors"
        >
          <Caret
            className={cn(
              "text-muted-foreground transition-transform",
              !open && "-rotate-90",
            )}
          />
          <span className="truncate">{title}</span>
        </button>
        {headerRight}
      </div>
      {open && (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          {children}
        </div>
      )}
    </div>
  );
}
