import type { JobStatus, SatelliteTool } from "api-server-api";

export interface SatelliteRow {
  owner: string;
  name: string;
  description: string | null;
  host: string | null;
  maxConcurrent: number;
  tools: SatelliteTool[];
  draining: boolean;
  lastSeenAt: Date | null;
}

export interface JobRow {
  owner: string;
  satellite: string;
  sequence: number;
  agentId: string;
  tool: string;
  args: Record<string, unknown>;
  status: JobStatus;
  approvalId: string | null;
  approved: boolean;
  isError: boolean;
  exitCode: number | null;
  output: string | null;
  truncated: boolean;
  reason: string | null;
  cancelRequested: boolean;
  cancelSentAt: Date | null;
  deliveredAt: Date | null;
  wokeAt: Date | null;
  awaitedUntil: Date | null;
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
