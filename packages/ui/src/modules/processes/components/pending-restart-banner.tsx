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
      `The agent reloads its settings, and ${one ? "the background task" : `the ${count} background tasks`} it waits for stop now.`,
      "Apply the settings change now?",
      { confirmLabel: "Apply now" },
    );
    if (confirmed) apply.mutate();
  }

  return (
    <Callout
      tone="warning"
      size="sm"
      data-testid="pending-restart-banner"
      className="m-3 flex flex-col gap-2 text-xs"
    >
      <p className="text-foreground">
        A settings change is waiting for {count} background{" "}
        {one ? "task" : "tasks"} to finish.
      </p>
      <Button
        variant="outline"
        size="xs"
        className="self-start"
        disabled={apply.isPending}
        onClick={() => void handleApply()}
      >
        Apply now (stops {countTasks(count)})
      </Button>
      <p className="text-muted-foreground">
        Stopping {one ? "the task" : "the tasks"}, or letting{" "}
        {one ? "it" : "them"} stop at hibernation, also lets the change apply.
      </p>
    </Callout>
  );
}
