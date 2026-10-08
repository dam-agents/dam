import type { PendingRestart } from "agent-runtime-api";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

import { useStore } from "../../../store.js";
import { useApplyPendingRestart } from "../api/mutations.js";
import { countTasks } from "../lib/process-copy.js";

interface Props {
  agentId: string;
  pendingRestart: PendingRestart;
}

export function PendingRestartBanner({ agentId, pendingRestart }: Props) {
  const showConfirm = useStore((s) => s.showConfirm);
  const apply = useApplyPendingRestart(agentId);
  const count = pendingRestart.blockingTasks;
  const one = count === 1;

  async function handleApply() {
    const confirmed = await showConfirm(
      `The agent reloads its settings, and ${one ? "the background task" : `the ${count} background tasks`} it waits for stop now. Stopping ${one ? "the task" : "the tasks"} yourself, or letting ${one ? "it" : "them"} stop at hibernation, also lets the change apply.`,
      "Apply the settings change now?",
      { confirmLabel: `Apply now (stops ${countTasks(count)})` },
    );
    if (confirmed) apply.mutate();
  }

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
        disabled={apply.isPending}
        onClick={() => void handleApply()}
      >
        Apply now
      </Button>
    </Callout>
  );
}
