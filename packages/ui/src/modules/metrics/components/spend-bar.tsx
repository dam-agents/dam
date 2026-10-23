import type { ReactNode } from "react";

interface Props {
  label: string;
  value: string;
  pct: number;
  color: string;
  caption?: ReactNode;
}

export function SpendBar({ label, value, pct, color, caption }: Props) {
  return (
    <div className="flex items-center gap-4 text-sm">
      <span className="flex w-[150px] shrink-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-full"
          style={{ background: color }}
        />
        <span className="truncate text-foreground" title={label}>
          {label}
        </span>
      </span>
      <div
        className="h-5 min-w-0 flex-1 overflow-hidden rounded bg-muted"
        role="img"
        aria-label={
          pct > 0 && pct < 1
            ? "less than 1% of the largest"
            : `${Math.round(pct)}% of the largest`
        }
      >
        {}
        <div
          className="h-full rounded"
          style={{
            width: pct > 0 ? `max(${pct}%, 8px)` : "0px",
            background: color,
          }}
        />
      </div>
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
