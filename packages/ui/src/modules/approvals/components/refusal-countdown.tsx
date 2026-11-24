import { useNow } from "../../../hooks/use-now.js";
import { timeLeftText } from "../lib/time-left.js";

const TICK_MS = 1000;

export function RefusalCountdown({ expiresAt }: { expiresAt: string }) {
  const now = useNow(TICK_MS);
  const left = timeLeftText(expiresAt, now);
  if (left === null) return null;
  return (
    <span
      data-testid="tool-call-countdown"
      title="The call is refused when the time runs out"
      className="shrink-0 rounded-full border border-warning/30 bg-warning-light px-2.5 py-0.5 font-mono text-2xs whitespace-nowrap tabular-nums text-warning-fg"
    >
      Refused in {left}
    </span>
  );
}
