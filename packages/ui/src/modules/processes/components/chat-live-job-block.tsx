import { StopFilledAlt } from "@carbon/icons-react";
import type { FinishedRow, ProcessRow } from "agent-runtime-api";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { ActivityBlock } from "../../sessions/components/activity-block.js";
import { WorkingDots } from "../../sessions/components/working-dots.js";
import { useStopProcess } from "../api/mutations.js";
import { useProcesses, useProcessOutput } from "../api/queries.js";
import { formatRunTime } from "../lib/format-process.js";

const TAIL_LINES = 20;
const TICK_MS = 5_000;

export function ChatLiveJobBlocks({ agentId }: { agentId: string | null }) {
  const { data } = useProcesses(agentId, { enabled: true, poll: true });

  const background = useMemo(
    () =>
      (data?.running ?? [])
        .filter((r) => r.kind !== "turn")
        .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)),
    [data],
  );

  const hibernated = useMemo(
    () => (data?.finished ?? []).filter((f) => f.endedBy === "hibernation"),
    [data],
  );

  if (background.length === 0 && hibernated.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 py-2">
      {background.map((row) => (
        <ChatLiveJobBlock key={row.key} agentId={agentId!} row={row} />
      ))}
      {hibernated.map((row) => (
        <HibernatedJobLine key={row.key} row={row} />
      ))}
    </div>
  );
}

function ChatLiveJobBlock({
  agentId,
  row,
}: {
  agentId: string;
  row: ProcessRow;
}) {
  const [open, setOpen] = useState(false);
  const now = useNow(TICK_MS);
  const setOpenProcessOutputKey = useStore((s) => s.setOpenProcessOutputKey);

  return (
    <ActivityBlock
      label={<JobLabel row={row} now={now} />}
      open={open}
      onToggle={() => setOpen((o) => !o)}
      actions={
        <JobActions
          agentId={agentId}
          row={row}
          onOpenOutput={() => setOpenProcessOutputKey(row.key)}
        />
      }
    >
      {open && <JobOutput agentId={agentId} processKey={row.key} />}
    </ActivityBlock>
  );
}

function JobLabel({ row, now }: { row: ProcessRow; now: Date }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
      <WorkingDots size="sm" className="text-success shrink-0" />
      <code className="font-mono text-sm text-foreground truncate max-w-[280px]">
        {row.command}
      </code>
      <span className="text-sm text-muted-foreground whitespace-nowrap">
        {formatRunTime(row.startedAt, now)}
      </span>
      {row.keepsAwake && (
        <span className="text-sm text-success whitespace-nowrap">
          keeps agent awake
        </span>
      )}
    </span>
  );
}

function JobActions({
  agentId,
  row,
  onOpenOutput,
}: {
  agentId: string;
  row: ProcessRow;
  onOpenOutput: () => void;
}) {
  const showConfirm = useStore((s) => s.showConfirm);
  const stop = useStopProcess(agentId);

  async function handleStop() {
    const confirmed = await showConfirm(
      <>
        Stop{" "}
        <code className="font-mono break-all text-foreground">
          {row.command}
        </code>
        ? It and the processes it started end now.
      </>,
      "Stop?",
      { confirmLabel: "Stop" },
    );
    if (confirmed) stop.mutate(row.key);
  }

  return (
    <span className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-xs text-muted-foreground"
        onClick={onOpenOutput}
      >
        Open full output
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground hover:text-destructive"
        aria-label={`Stop ${row.command}`}
        disabled={stop.isPending || row.pid === null}
        onClick={() => void handleStop()}
      >
        <StopFilledAlt size={14} />
      </Button>
    </span>
  );
}

function JobOutput({
  agentId,
  processKey,
}: {
  agentId: string;
  processKey: string;
}) {
  const { data, isPending } = useProcessOutput(agentId, processKey, true);

  if (isPending)
    return (
      <p className="text-xs text-muted-foreground py-1">Loading output…</p>
    );
  if (!data?.text)
    return <p className="text-xs text-muted-foreground py-1">No output yet.</p>;

  const lines = data.text.split("\n");
  const tail = lines.slice(-TAIL_LINES).join("\n");

  return (
    <div className="mt-1">
      {lines.length > TAIL_LINES && (
        <p className="text-2xs text-muted-foreground mb-1">
          Showing last {TAIL_LINES} lines
        </p>
      )}
      <pre
        className={cn(
          "overflow-x-auto rounded-md bg-muted/50 p-2",
          "font-mono text-xs text-foreground whitespace-pre-wrap break-all",
          "max-h-[240px] overflow-y-auto",
        )}
      >
        {tail}
      </pre>
    </div>
  );
}

function HibernatedJobLine({ row }: { row: FinishedRow }) {
  return (
    <p className="text-sm italic text-muted-foreground pl-3 border-l-2 border-border">
      <code className="font-mono not-italic">{row.command}</code> ended — agent
      went to sleep
    </p>
  );
}
