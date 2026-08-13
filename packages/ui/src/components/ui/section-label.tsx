import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { labelVariants } from "./label.js";

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
    <span className={cn(labelVariants(), spaced && "mb-3 block", className)}>
      {children}
    </span>
  );
}
