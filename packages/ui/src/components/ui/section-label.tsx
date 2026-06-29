import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { labelVariants } from "./label.js";

/**
 * The project's label, sharing its style with the Radix `Label`. Renders a
 * `<span>` for section/group headings and as the label text inside
 * `FormField`. Reach for `Label` when the element must be a real `<label>`.
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
    <span className={cn(labelVariants(), spaced && "mb-3 block", className)}>
      {children}
    </span>
  );
}
