import type {
  ProcessContainer,
  ProcessKind,
  ProcessRow,
} from "agent-runtime-api";

type ContainerRole = ProcessContainer["role"];

export type ProcessGroupId = "turn" | "awake" | "hibernates" | "always-on";

export interface ProcessGroup {
  id: ProcessGroupId;
  rows: readonly ProcessRow[];
}

const PROCESS_KIND_ORDER: readonly ProcessKind[] = [
  "turn",
  "harness-task",
  "detached",
  "startup-item",
];

const CONTAINER_ROLE_ORDER: readonly (ContainerRole | null)[] = [
  null,
  "runtime",
  "container",
];

function containerRank(row: ProcessRow): number {
  return CONTAINER_ROLE_ORDER.indexOf(row.container?.role ?? null);
}

function byKindThenStart(a: ProcessRow, b: ProcessRow): number {
  return (
    PROCESS_KIND_ORDER.indexOf(a.kind) - PROCESS_KIND_ORDER.indexOf(b.kind) ||
    containerRank(a) - containerRank(b) ||
    Date.parse(a.startedAt) - Date.parse(b.startedAt)
  );
}

export function groupProcesses(
  running: readonly ProcessRow[],
  alwaysOn: boolean,
): ProcessGroup[] {
  const sorted = running
    .filter((row) => row.kind !== "startup-item")
    .sort(byKindThenStart);
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
