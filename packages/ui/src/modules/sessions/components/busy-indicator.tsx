import { cn } from "@/lib/utils";

import { WorkingDots } from "./working-dots.js";

export function BusyIndicator({ className }: { className?: string }) {
  return (
    <span role="status" className={cn("inline-flex items-center", className)}>
      <WorkingDots size="md" className="text-accent" />
      <span className="sr-only">Working</span>
    </span>
  );
}
