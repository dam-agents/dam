import { Information, Play } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export function AgentStoppedCallout({
  children,
  comingUp,
  onStart,
  className,
}: {
  children: ReactNode;
  comingUp: boolean;
  onStart: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border border-border bg-muted px-4 py-3 text-sm",
        className,
      )}
    >
      <Information size={16} className="mt-px shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">This agent is stopped</span>{" "}
        <span className="text-muted-foreground">{children}</span>
      </p>
      <Button
        size="sm"
        disabled={comingUp}
        onClick={onStart}
        className="shrink-0"
      >
        {comingUp ? <Spinner size={13} /> : <Play size={14} />}
        {comingUp ? "Starting…" : "Start agent"}
      </Button>
    </div>
  );
}
