import { Close } from "@carbon/icons-react";
import type { GettingStartedTask } from "api-server-api";

import { Button } from "@/components/ui/button";

import { AgentAvatar } from "../../agents/components/avatar/agent-avatar.js";
import type { ChecklistRow } from "../lib/derive-checklist.js";
import { TASK_HINTS, TASK_TITLES } from "../lib/tasks.js";
import { AvatarEgg } from "./avatar-egg.js";
import { ChecklistTaskRow } from "./checklist-task-row.js";
import { ProgressRing } from "./progress-ring.js";

interface Props {
  rows: readonly ChecklistRow[];
  onClose: () => void;
  onDismiss: () => void;
  onStart: (task: GettingStartedTask) => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The checklist itself: how far the user is, the
 * eight characters as slots, and the tasks that unlock them. An unlocked
 * character takes its slot, a locked one keeps the egg, so the strip is the
 * reward the rows below describe. A click on a row opens the place where the
 * task is done and closes the popover; Dismiss hides the checklist until the
 * next unlock or the avatar picker.
 */
export function ChecklistPanel({ rows, onClose, onDismiss, onStart }: Props) {
  const done = rows.filter((row) => row.reward !== null).length;
  const total = rows.length;
  return (
    <section
      aria-label="Get started"
      data-testid="getting-started-checklist"
      className="flex max-h-[min(80vh,600px)] w-[340px] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-xl"
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
          aria-label="Close checklist"
          tooltip="Close checklist"
          onClick={onClose}
        >
          <Close size={16} />
        </Button>
      </div>

      <div
        data-testid="getting-started-slots"
        className="flex gap-1.5 border-t border-border px-4 py-2.5"
      >
        {rows.map((row) => (
          <span
            key={row.task}
            className="flex size-7 items-center justify-center rounded-md border border-border/70"
          >
            {row.reward ? (
              <AgentAvatar name="" avatar={row.reward} size={22} />
            ) : (
              <AvatarEgg className="size-5" />
            )}
          </span>
        ))}
      </div>

      <ul className="min-h-0 overflow-y-auto border-t border-border py-1.5">
        {rows.map((row) => (
          <ChecklistTaskRow
            key={row.task}
            title={TASK_TITLES[row.task]}
            hint={TASK_HINTS[row.task]}
            reward={row.reward}
            onStart={() => onStart(row.task)}
          />
        ))}
      </ul>
      <div className="flex justify-end border-t border-border px-4 py-2">
        <button
          type="button"
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </div>
    </section>
  );
}
