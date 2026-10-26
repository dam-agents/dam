import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function StatusLine({
  testId,
  tone = "warning",
  children,
}: {
  testId?: string;
  tone?: "warning" | "muted";
  children: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 min-h-11 text-sm anim-in"
    >
      <span
        className={cn(
          "h-2 w-2 rounded-full shrink-0",
          tone === "warning" ? "bg-warning" : "bg-muted-foreground",
        )}
      />
      {children}
    </div>
  );
}
