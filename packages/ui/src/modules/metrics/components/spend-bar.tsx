import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface Props {
  label: string;
  value: string;
  pct: number;
  color: string;
  caption?: ReactNode;
  icon?: ReactNode;
}

export function SpendBarTrack({
  pct,
  label,
  color,
  fillClassName,
  className,
  extraPct = 0,
  extraFillClassName,
}: {
  pct: number;
  label: string;
  color?: string;
  fillClassName?: string;
  className?: string;
  extraPct?: number;
  extraFillClassName?: string;
}) {
  const hasExtra = extraPct > 0;
  return (
    <div
      className={cn("flex h-5 overflow-hidden rounded bg-muted", className)}
      role="img"
      aria-label={label}
    >
      <div
        className={cn(
          "h-full shrink-0 rounded",
          fillClassName,
          hasExtra && "rounded-r-none",
        )}
        style={{
          width: pct > 0 ? `max(${pct}%, 8px)` : "0px",
          background: color,
        }}
      />
      {hasExtra && (
        <div
          className={cn(
            "h-full shrink-0 rounded",
            extraFillClassName,
            pct > 0 && "rounded-l-none",
          )}
          style={{ width: `${extraPct}%` }}
        />
      )}
    </div>
  );
}

export function SpendBar({ label, value, pct, color, caption, icon }: Props) {
  return (
    <div className="flex items-center gap-4 text-sm">
      <span className="flex w-[150px] shrink-0 items-center gap-2">
        {icon}
        <span className="truncate text-foreground" title={label}>
          {label}
        </span>
      </span>
      <SpendBarTrack
        pct={pct}
        color={color}
        className="min-w-0 flex-1"
        label={
          pct > 0 && pct < 1
            ? "less than 1% of the largest"
            : `${Math.round(pct)}% of the largest`
        }
      />
      <span className="flex w-28 shrink-0 flex-col items-end gap-1.5">
        <span className="font-mono font-semibold leading-none tabular-nums text-foreground">
          {value}
        </span>
        {caption && (
          <span className="flex items-center gap-1 font-mono text-xs leading-none tabular-nums text-muted-foreground">
            {caption}
          </span>
        )}
      </span>
    </div>
  );
}
