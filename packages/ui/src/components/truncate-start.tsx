import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Truncates overflowing text at the start (ellipsis on the left) so the tail
 *  stays visible — e.g. file paths where the filename matters most. Built on
 *  the dir=rtl layout trick; the invisible U+200E (LRM) guards stop
 *  bidi-neutral edge characters (leading dots, bullets) from being reordered
 *  to the wrong side. */
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
      {/* select-none keeps the invisible marks out of copied selections. */}
      <span className="select-none">{"\u200E"}</span>
      {children}
      <span className="select-none">{"\u200E"}</span>
    </span>
  );
}
