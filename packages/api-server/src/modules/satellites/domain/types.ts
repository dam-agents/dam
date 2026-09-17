import type { JobStatus, SatelliteCommand } from "api-server-api";

export interface SatelliteRow {
  owner: string;
  name: string;
  description: string | null;
  host: string | null;
  maxConcurrent: number;
  commands: SatelliteCommand[];
  draining: boolean;
  lastSeenAt: Date | null;
}

export interface JobRow {
  owner: string;
  satellite: string;
  sequence: number;
  agentId: string;
  cmd: string[];
  pattern: string;
  status: JobStatus;
  approvalId: string | null;
  exitCode: number | null;
  output: string | null;
  truncated: boolean;
  reason: string | null;
  cancelRequested: boolean;
  deliveredAt: Date | null;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
}

export const TERMINAL_STATUSES: readonly JobStatus[] = [
  "done",
  "interrupted",
  "cancelled",
];

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}
