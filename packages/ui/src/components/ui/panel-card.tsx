import type { ReactNode } from "react";

import { CARD_SURFACE } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface PanelCardProps {
  icon?: ReactNode;
  title: string;
  /** Sits directly after the title. */
  titleAccessory?: ReactNode;
  /** Pushed to the header's trailing edge. */
  headerRight?: ReactNode;
  testId?: string;
  className?: string;
  children: ReactNode;
}

/** A card introduced by a fixed-height header: icon, title, and a slot either
 *  side of the gap. */
export function PanelCard({
  icon,
  title,
  titleAccessory,
  headerRight,
  testId,
  className,
  children,
}: PanelCardProps) {
  return (
    <section data-testid={testId} className={cn(CARD_SURFACE, className)}>
      <header className="flex h-[52px] items-center gap-2.5 border-b border-border px-4">
        {icon}
        <h3 className="min-w-0 truncate text-[15px] font-semibold text-foreground">
          {title}
        </h3>
        {titleAccessory}
        {headerRight && (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {headerRight}
          </div>
        )}
      </header>
      {children}
    </section>
  );
}
