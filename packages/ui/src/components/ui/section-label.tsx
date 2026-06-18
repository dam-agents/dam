import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The project's section/field label. Once the redesign lands, this should
 * replace the Radix `Label` primitive (`@/components/ui/label`) everywhere so
 * there is a single label component across the app.
 */
export function SectionLabel({
  className,
  spaced = false,
  children,
}: {
  className?: string;
  spaced?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "text-[11px] font-medium uppercase leading-[17.05px] tracking-[1.65px] text-muted-foreground",
        spaced && "mb-3 block",
        className,
      )}
    >
      {children}
    </span>
  );
}
