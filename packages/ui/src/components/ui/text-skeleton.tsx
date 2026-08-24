import { cn } from "@/lib/utils";

interface Props {
  width: number | string;
  tone?: "primary" | "muted";
  className?: string;
}

export function TextSkeleton({ width, tone = "primary", className }: Props) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-[0.7em] animate-pulse rounded align-middle",
        tone === "muted" ? "bg-muted/60" : "bg-muted",
        className,
      )}
      style={{ width: typeof width === "number" ? `${width}px` : width }}
    />
  );
}
