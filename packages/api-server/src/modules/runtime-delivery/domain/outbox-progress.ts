import type { DriverFailure } from "api-server-api";

/** The outbox cursors a progress verdict reads. Declared structurally so this
 *  stays a pure predicate over the row rather than a dependency on the repo. */
export interface OutboxCursors {
  version: number;
  lastSettledVersion: number;
  lastAppliedVersion: number;
  applyFailures: DriverFailure[];
}

export interface ContributionsProgress {
  /** The version the outbox wants applied. Carried so a caller can tell a
   *  stable row from one that moved under it between two reads. */
  version: number;
  /** The agent answered for the current version. A failed apply answers too. */
  settled: boolean;
  /** The agent answered *cleanly*: its disk reflects the current version. */
  applied: boolean;
  /** The drivers that failed the last settle. */
  failures: DriverFailure[];
}

/** No row means nothing was ever asked of the agent, so it is trivially caught
 *  up. Version 0 is below the first bump's 1, so a row appearing between two
 *  reads still reads as a change. */
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
