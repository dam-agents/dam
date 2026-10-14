import { useState } from "react";

import { CopyButton } from "@/components/ui/copy-button";
import { HOVER_ACTION } from "@/components/ui/hover-action";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import type { ToolChip } from "../../../types.js";
import { groupLabel, runningChip } from "../lib/activity-groups.js";
import { ActivityBlock } from "./activity-block.js";
import { ToolPart } from "./chat-message-part.js";

function RunningLabel({ chip, step }: { chip: ToolChip; step: number }) {
  const text = chip.description ?? chip.title;
  return (
    <span className="flex min-w-0 flex-1 items-start gap-1.5">
      <Spinner size={12} className="mt-1 text-inherit" />
      <span
        className={cn(
          "min-w-0 truncate text-foreground",
          !chip.description && "font-mono text-[13px]",
        )}
        title={text}
      >
        {text}
      </span>
      <span className="mt-0.5 shrink-0 text-2xs tabular-nums">step {step}</span>
    </span>
  );
}

function DoneLabel({ chips }: { chips: readonly ToolChip[] }) {
  const failed = chips.filter((chip) => chip.status === "failed").length;
  const label = groupLabel(chips);
  return (
    <span className="min-w-0 truncate" title={label}>
      {label}
      {failed > 0 && (
        <span className="text-danger tabular-nums">, {failed} failed</span>
      )}
    </span>
  );
}

export function ActivityGroup({
  chips,
  streaming,
}: {
  chips: readonly ToolChip[];
  streaming: boolean;
}) {
  const expanded = useStore((s) => s.toolActivityExpanded);
  const [open, setOpen] = useState(expanded);
  const running = streaming ? runningChip(chips) : undefined;

  return (
    <ActivityBlock
      open={open}
      onToggle={() => setOpen((o) => !o)}
      label={
        running ? (
          <RunningLabel chip={running.chip} step={running.step} />
        ) : (
          <DoneLabel chips={chips} />
        )
      }
      actions={
        <CopyButton
          value={chips.map((chip) => chip.title).join("\n")}
          label="Copy steps"
          stopPropagation
          className={HOVER_ACTION}
        />
      }
    >
      <div className="flex flex-col gap-2">
        {chips.map((chip, i) => (
          <ToolPart key={chip.toolCallId ?? i} chip={chip} />
        ))}
      </div>
    </ActivityBlock>
  );
}
