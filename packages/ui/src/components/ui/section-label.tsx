import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function SectionLabel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "text-[11px] font-medium uppercase leading-[17.05px] tracking-[1.65px] text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}
