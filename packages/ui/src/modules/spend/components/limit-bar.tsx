import { cn } from "@/lib/utils";

import { SpendBarTrack } from "../../metrics/components/spend-bar.js";

interface Props {
  pct: number;
  label: string;
  size?: "md" | "sm";
  percent?: boolean;
  className?: string;
}

const SIZE = {
  md: "h-3 rounded-sm",
  sm: "h-1 rounded-full",
} as const;

export function LimitBar({
  pct,
  label,
  size = "md",
  percent = true,
  className,
}: Props) {
  const track = (
    <SpendBarTrack
      pct={pct}
      label={label}
      className={percent ? "flex-1" : className}
      trackClassName={cn(SIZE[size], "bg-foreground/10")}
      fillClassName="bg-foreground"
    />
  );
  if (!percent) return track;
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      {track}
      <span className="min-w-9 text-right text-xs text-muted-foreground tabular-nums">
        {`${String(Math.round(pct))}%`}
      </span>
    </div>
  );
}
