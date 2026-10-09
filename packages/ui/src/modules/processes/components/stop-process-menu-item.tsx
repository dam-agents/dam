import { StopFilledAlt } from "@carbon/icons-react";
import type { ProcessRow } from "agent-runtime-api";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

import { useStore } from "../../../store.js";
import { useStopProcess } from "../api/mutations.js";
import { NO_PID_STOP_HINT } from "../lib/process-copy.js";
import { MenuItemText } from "./menu-item-text.js";

interface Props {
  agentId: string;
  row: ProcessRow;
}

export function StopProcessMenuItem({ agentId, row }: Props) {
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

  if (row.pid === null)
    return (
      <DropdownMenuItem tone="danger" disabled className="h-auto py-2">
        <StopFilledAlt size={14} />
        <MenuItemText label="Stop" caption={NO_PID_STOP_HINT} />
      </DropdownMenuItem>
    );

  return (
    <DropdownMenuItem
      tone="danger"
      data-testid="process-stop"
      disabled={stop.isPending}
      onSelect={() => void handleStop()}
    >
      <StopFilledAlt size={14} />
      Stop…
    </DropdownMenuItem>
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
