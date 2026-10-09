import type { ProcessKind, ProcessRow } from "agent-runtime-api";

export type ProcessGroupId = "turn" | "awake" | "hibernates" | "always-on";

export interface ProcessGroup {
  id: ProcessGroupId;
  rows: readonly ProcessRow[];
}

const PROCESS_KIND_ORDER: readonly ProcessKind[] = [
  "turn",
  "harness-task",
  "detached",
];

function byKindThenStart(a: ProcessRow, b: ProcessRow): number {
  return (
    PROCESS_KIND_ORDER.indexOf(a.kind) - PROCESS_KIND_ORDER.indexOf(b.kind) ||
    Date.parse(a.startedAt) - Date.parse(b.startedAt)
  );
}

export function groupProcesses(
  running: readonly ProcessRow[],
  alwaysOn: boolean,
): ProcessGroup[] {
  const sorted = [...running].sort(byKindThenStart);
  const turn = sorted.filter((row) => row.kind === "turn");
  const background = sorted.filter((row) => row.kind !== "turn");
  const groups: ProcessGroup[] = alwaysOn
    ? [
        { id: "turn", rows: turn },
        { id: "always-on", rows: background },
      ]
    : [
        { id: "turn", rows: turn },
        { id: "awake", rows: background.filter((row) => row.keepsAwake) },
        { id: "hibernates", rows: background.filter((row) => !row.keepsAwake) },
      ];
  return groups.filter((group) => group.rows.length > 0);
}
