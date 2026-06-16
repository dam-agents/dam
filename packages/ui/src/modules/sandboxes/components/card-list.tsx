import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function CardList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 md:-ml-4", className)}>
      {children}
    </div>
  );
}
