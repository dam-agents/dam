import { ChevronDown } from "@carbon/icons-react";
import type { GettingStartedTask } from "api-server-api";
import type { Ref } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useExitAnimation } from "../hooks/use-exit-animation.js";
import type { ChecklistRow } from "../lib/derive-checklist.js";
import { TASK_TITLES } from "../lib/tasks.js";
import { ChecklistTaskRow } from "./checklist-task-row.js";
import { ProgressRing } from "./progress-ring.js";

interface Props {
  rows: readonly ChecklistRow[];
  onCollapse: () => void;
  onDismiss: () => void;
  onStart: (task: GettingStartedTask) => void;
  ref?: Ref<HTMLElement>;
}

export function ChecklistPanel({
  rows,
  onCollapse,
  onDismiss,
  onStart,
  ref,
}: Props) {
  const { exiting, exit } = useExitAnimation(onDismiss);
  const done = rows.filter((row) => row.reward !== null).length;
  const total = rows.length;
  return (
    <section
      ref={ref}
      aria-label="Get started"
      data-testid="getting-started-dock"
      tabIndex={-1}
      className={cn(
        "flex max-h-[calc(100dvh-10rem)] w-[min(340px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl focus:outline-hidden",
        "animate-[dock-enter_0.3s_ease-out]",
        exiting && "animate-[dock-exit_0.3s_ease-in_forwards]",
      )}
    >
      <div className="flex items-center gap-3 px-4 pt-3.5 pb-3">
        <ProgressRing done={done} total={total} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Get started</p>
          <p className="text-sm text-muted-foreground">
            {done} of {total} done{done > 0 && " · unlock new avatars"}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Collapse checklist"
          tooltip="Collapse checklist"
          onClick={onCollapse}
        >
          <ChevronDown size={16} />
        </Button>
      </div>

      <ul className="min-h-0 overflow-y-auto border-t border-border py-1.5">
        {rows.map((row) => (
          <ChecklistTaskRow
            key={row.task}
            title={TASK_TITLES[row.task]}
            reward={row.reward}
            showReward={done > 0}
            onStart={() => onStart(row.task)}
          />
        ))}
      </ul>
      <div className="flex justify-end border-t border-border px-4 py-2">
        <button
          type="button"
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          onClick={exit}
        >
          Dismiss
        </button>
      </div>
    </section>
  );
}
