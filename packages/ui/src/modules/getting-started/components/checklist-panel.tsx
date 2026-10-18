import type { GettingStartedTask } from "api-server-api";

import type { ChecklistRow } from "../lib/derive-checklist.js";
import { TASK_TITLES } from "../lib/tasks.js";
import { ChecklistTaskRow } from "./checklist-task-row.js";

interface Props {
  rows: readonly ChecklistRow[];
  showRewards: boolean;
  onStart: (task: GettingStartedTask) => void;
}

export function ChecklistPanel({ rows, showRewards, onStart }: Props) {
  return (
    <ul className="py-1.5">
      {rows.map((row) => (
        <ChecklistTaskRow
          key={row.task}
          title={TASK_TITLES[row.task]}
          reward={row.reward}
          showReward={showRewards}
          onStart={() => onStart(row.task)}
        />
      ))}
    </ul>
  );
}
