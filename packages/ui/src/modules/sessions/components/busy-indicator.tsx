import { cn } from "@/lib/utils";

import { WorkingDots } from "./working-dots.js";

/** Streaming indicator for the chat thread. The jumping dots carry "working,
 *  not frozen"; the activity rows above say what the agent is doing. No status
 *  word — it would only restate what both already show (#3060).
 *
 *  The dots are the sole visual cue, so unlike a decorative spinner this always
 *  announces itself. */
export function BusyIndicator({ className }: { className?: string }) {
  return (
    <span role="status" className={cn("inline-flex items-center", className)}>
      <WorkingDots size="md" className="text-accent" />
      <span className="sr-only">Working</span>
    </span>
  );
}
