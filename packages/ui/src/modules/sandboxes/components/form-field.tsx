import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function FormField({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("md:-ml-4", className)}>{children}</div>;
}
