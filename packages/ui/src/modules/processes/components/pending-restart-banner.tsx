import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

import type { PendingRestart } from "../types.js";

interface Props {
  agentId: string;
  pendingRestart: PendingRestart;
}

export function PendingRestartBanner({ pendingRestart }: Props) {
  const count = pendingRestart.blockingTasks;
  const one = count === 1;

  return (
    <Callout
      tone="warning"
      size="sm"
      data-testid="pending-restart-banner"
      className="mx-3 my-2.5 flex items-center gap-2.5 text-xs"
    >
      <p className="flex-1 text-foreground">
        A settings change waits for {count} background {one ? "task" : "tasks"}.
      </p>
      <Button variant="outline" size="xs" className="shrink-0">
        Apply now
      </Button>
    </Callout>
  );
}
