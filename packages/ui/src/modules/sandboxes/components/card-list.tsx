import type { ReactNode } from "react";

import { Inset } from "@/components/ui/inset";
import { cn } from "@/lib/utils";

export function CardList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Inset className={cn("flex flex-col gap-3", className)}>{children}</Inset>
  );
}

export function CardGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Inset className={cn("grid gap-3 sm:grid-cols-2", className)}>
      {children}
    </Inset>
  );
}
