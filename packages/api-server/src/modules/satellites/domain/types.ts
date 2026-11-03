import type { JobStatus, SatelliteImage, SatelliteTool } from "api-server-api";

export interface SatelliteRow {
  owner: string;
  name: string;
  description: string | null;
  host: string | null;
  maxConcurrent: number;
  tools: SatelliteTool[];
  draining: boolean;
  lastSeenAt: Date | null;
  createdAt: Date;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Which registration of a Satellite a row is. A name
 * outlives the row that held it: removing a Satellite and registering the same
 * name again restarts its job sequence at 1, so a worker's late report is
 * matched against the registration it served rather than against the name.
 */
export function incarnationOf(row: { createdAt: Date }): string {
  return row.createdAt.toISOString();
}

export interface JobRow {
  owner: string;
  satellite: string;
  sequence: number;
  agentId: string;
  tool: string;
  args: Record<string, unknown>;
  status: JobStatus;
  isError: boolean;
  exitCode: number | null;
  output: string | null;
  images: SatelliteImage[];
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
