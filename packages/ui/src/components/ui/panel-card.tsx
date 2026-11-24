import type { ReactNode } from "react";

import { CARD_SURFACE } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface PanelCardProps {
  icon?: ReactNode;
  title: string;
  titleAccessory?: ReactNode;
  headerRight?: ReactNode;
  testId?: string;
  className?: string;
  children: ReactNode;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The chat refresh design's titled card: a 52 px
 * header with an icon, the title and an accessory beside it, then the
 * content.
 */
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
