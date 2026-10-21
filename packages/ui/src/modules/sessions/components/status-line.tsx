import type { ReactNode } from "react";

export function StatusLine({
  testId,
  children,
}: {
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 min-h-11 text-sm anim-in"
    >
      <span className="h-2 w-2 rounded-full bg-warning shrink-0" />
      {children}
    </div>
  );
}
