import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export const FIELD_INSET = "md:-ml-4";

export const LABEL_INSET = "md:ml-4";

export function Inset({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn(FIELD_INSET, className)}>{children}</div>;
}
