import type { PendingRestart } from "agent-runtime-api";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

import { useStore } from "../../../store.js";
import { useApplyPendingRestart } from "../api/mutations.js";
import {
  countRestartStops,
  describeRestartStops,
} from "../lib/process-copy.js";

interface Props {
  agentId: string;
  pendingRestart: PendingRestart;
}

export function useApplyPendingRestartWithConfirm(
  agentId: string,
  pendingRestart: PendingRestart,
) {
  const showConfirm = useStore((s) => s.showConfirm);
  const apply = useApplyPendingRestart(agentId);
  const one = pendingRestart.blockingTasks === 1;
  return {
    pending: apply.isPending,
    apply: async () => {
      const confirmed = await showConfirm(
        `The agent reloads its settings, and this stops ${describeRestartStops(pendingRestart.stops)} now. Stopping ${one ? "the task" : "the tasks"} it waits for yourself, or letting ${one ? "it" : "them"} stop at hibernation, also lets the change apply.`,
        "Apply the settings change now?",
        {
          confirmLabel: `Apply now (stops ${countRestartStops(pendingRestart.stops)})`,
        },
      );
      if (confirmed) apply.mutate();
    },
  };
}

export function PendingRestartBanner({ agentId, pendingRestart }: Props) {
  const restart = useApplyPendingRestartWithConfirm(agentId, pendingRestart);
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
      <Button
        variant="outline"
        size="xs"
        className="shrink-0"
        disabled={restart.pending}
        onClick={() => void restart.apply()}
      >
        Apply now
      </Button>
    </Callout>
  );
}
