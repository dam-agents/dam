import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function TruncateStart({
  className,
  title,
  children,
}: {
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      dir="rtl"
      title={title}
      className={cn("truncate text-left", className)}
    >
      {}
      <span className="select-none">{"\u200E"}</span>
      {children}
      <span className="select-none">{"\u200E"}</span>
    </span>
  );
}
