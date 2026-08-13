import type { DriverFailure } from "api-server-api";

export interface OutboxCursors {
  version: number;
  lastSettledVersion: number;
  lastAppliedVersion: number;
  applyFailures: DriverFailure[];
}

export interface ContributionsProgress {
  version: number;
  settled: boolean;
  applied: boolean;
  failures: DriverFailure[];
}

export function progressOf(row: OutboxCursors | null): ContributionsProgress {
  if (row === null)
    return { version: 0, settled: true, applied: true, failures: [] };
  return {
    version: row.version,
    settled: row.lastSettledVersion >= row.version,
    applied: row.lastAppliedVersion >= row.version,
    failures: row.applyFailures,
  };
}
