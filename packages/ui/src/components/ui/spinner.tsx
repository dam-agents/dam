import { cn } from "@/lib/utils";

interface SpinnerProps {
  size?: number;
  label?: string;
  className?: string;
}

export function Spinner({ size = 14, label, className }: SpinnerProps) {
  const ring = (
    <span
      aria-hidden={label ? undefined : true}
      className={cn(
        "inline-block shrink-0 animate-spin rounded-full border-current/25 border-t-current text-foreground",
        className,
      )}
      style={{
        width: size,
        height: size,
        borderWidth: Math.max(2, Math.round(size / 12)),
      }}
    />
  );
  if (!label) return ring;
  return (
    <span role="status" className="inline-flex">
      {ring}
      <span className="sr-only">{label}</span>
    </span>
  );
}
