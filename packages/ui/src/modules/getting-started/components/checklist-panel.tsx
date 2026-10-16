import type { GettingStartedTask } from "api-server-api";
import type { AvatarCharacter } from "api-server-api/avatar/svg";

import { cn } from "@/lib/utils";

import type { ChecklistRow } from "../lib/derive-checklist.js";
import { TASK_TITLES } from "../lib/tasks.js";
import { AvatarSlot } from "./avatar-slot.js";
import { ChecklistTaskRow } from "./checklist-task-row.js";

interface Props {
  rows: readonly ChecklistRow[];
  unlocked: readonly AvatarCharacter[];
  justUnlocked: AvatarCharacter | null;
  onDismiss: () => void;
  onStart: (task: GettingStartedTask) => void;
}

export function ChecklistPanel({
  rows,
  unlocked,
  justUnlocked,
  onDismiss,
  onStart,
}: Props) {
  const done = unlocked.length;
  const total = rows.length;
  const showAvatars = done > 0;
  return (
    <div className="flex flex-col">
      <p className="px-4 pt-3 pb-3 text-sm text-muted-foreground">
        {done} of {total} done
        {showAvatars && " · unlock new avatars"}
      </p>

      {showAvatars && (
        <div
          className={cn(
            "flex flex-wrap gap-1.5 px-4 pb-3",
            done === 1 &&
              justUnlocked &&
              "animate-[dock-reveal_0.45s_cubic-bezier(0.34,1.56,0.64,1)]",
          )}
        >
          {rows.map((_, i) => (
            <AvatarSlot
              key={unlocked[i] ?? `egg-${i}`}
              character={unlocked[i] ?? null}
              justUnlocked={
                unlocked[i] !== undefined && unlocked[i] === justUnlocked
              }
            />
          ))}
        </div>
      )}

      <ul className="border-t border-border py-1.5">
        {rows.map((row) => (
          <ChecklistTaskRow
            key={row.task}
            title={TASK_TITLES[row.task]}
            reward={row.reward}
            showReward={showAvatars}
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
    </div>
  );
}
