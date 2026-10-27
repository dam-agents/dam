import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface WorkCardShellProps {
  icon: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  accessory?: ReactNode;
  onClick?: () => void;
}

export function WorkCardShell({
  icon,
  title,
  detail,
  accessory,
  onClick,
}: WorkCardShellProps) {
  const interactive = !!onClick;
  return (
    <button
      type="button"
      disabled={!interactive}
      onClick={onClick}
      className={cn(
        "not-prose flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left text-sm transition-colors",
        interactive &&
          "cursor-pointer hover:border-accent/60 hover:bg-accent-light",
        !interactive && "cursor-default",
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground">
          {title}
        </span>
        {detail && (
          <span className="block truncate text-xs text-muted-foreground">
            {detail}
          </span>
        )}
      </span>
      {accessory && <span className="shrink-0">{accessory}</span>}
      {interactive && (
        <span className="shrink-0 text-muted-foreground/40 transition-colors group-hover:text-foreground">
          ›
        </span>
      )}
    </button>
  );
}
