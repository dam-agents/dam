import type { ProcessRow } from "agent-runtime-api";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { useStopProcess } from "../api/mutations.js";
import { NO_PID_STOP_HINT } from "../lib/process-copy.js";

interface Props {
  agentId: string;
  row: ProcessRow;
}

export function StopProcessButton({ agentId, row }: Props) {
  const showConfirm = useStore((s) => s.showConfirm);
  const stop = useStopProcess(agentId);

  async function handleStop() {
    const confirmed = await showConfirm(
      <StopConfirmMessage row={row} />,
      "Stop process",
      { confirmLabel: "Stop" },
    );
    if (confirmed) stop.mutate(row.key);
  }

  return (
    <Button
      variant="ghost"
      tone="danger"
      size="xs"
      className="shrink-0 font-normal"
      aria-label={`Stop ${row.command}`}
      data-testid="process-stop"
      disabled={row.pid === null || stop.isPending}
      tooltip={row.pid === null ? NO_PID_STOP_HINT : undefined}
      onClick={() => void handleStop()}
    >
      Stop
    </Button>
  );
}

function StopConfirmMessage({ row }: { row: ProcessRow }) {
  return (
    <>
      Stop{" "}
      <code className="font-mono break-all text-foreground">{row.command}</code>
      ? It and the processes it started end now.
      {row.kind === "turn" && " The agent's current step will fail."}
    </>
  );
}
