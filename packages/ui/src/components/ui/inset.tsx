import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The base-level field outdent. On `md+` it shifts a control (or a `p-4`
 * bordered group) left by 16px, cancelling the inner padding so the content's
 * text lines up with the label while the box bleeds into the page gutter.
 * Only meaningful on standalone centered pages — not in modals or nested
 * containers. Reusable on any element; `FormField` applies it via `inset`.
 */
export const FIELD_INSET = "md:-ml-4";

export function Inset({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn(FIELD_INSET, className)}>{children}</div>;
}
