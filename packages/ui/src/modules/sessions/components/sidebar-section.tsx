import type { CSSProperties, ReactNode } from "react";

import { DisclosureToggle } from "@/components/ui/disclosure";
import { cn } from "@/lib/utils";

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
          "flex items-center gap-1 pl-3 pr-2 h-[44px] shrink-0 border-border",
          open && "border-b",
          headerClassName,
        )}
      >
        {headerLeft}
        <DisclosureToggle
          open={open}
          onToggle={onToggle}
          chevronClassName="text-muted-foreground"
          className="min-w-0 flex-1 text-sm font-medium text-foreground transition-colors"
        >
          <span className="truncate">{title}</span>
        </DisclosureToggle>
        {headerRight}
      </div>
      {/* Stays mounted while collapsed so the parent-driven height change
          can animate; the section root clips the squeezed content. */}
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
