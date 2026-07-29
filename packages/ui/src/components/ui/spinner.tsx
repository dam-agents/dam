import { cn } from "@/lib/utils";

interface SpinnerProps {
  /** Diameter in px. */
  size?: number;
  /** Announce the busy state. Omit when adjacent text already says it — the
   *  spinner is then decorative and hidden from assistive tech. */
  label?: string;
  className?: string;
}

/** The one spinner. Draws in the foreground colour so every loading state
 *  matches, whatever the surrounding text; pass `text-inherit` for the few
 *  places that must take their container's colour (a warning bar, a failed
 *  tool row). */
export function Spinner({ size = 14, label, className }: SpinnerProps) {
  const ring = (
    <span
      aria-hidden={label ? undefined : true}
      className={cn(
        "inline-block shrink-0 animate-spin rounded-full border-current/25 border-t-current text-foreground",
        className,
      )}
      // Stroke tracks the diameter so the ring reads the same at 11px and 40px.
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
