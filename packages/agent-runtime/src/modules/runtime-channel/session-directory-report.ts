import type { SessionDirectoryEntry } from "agent-runtime-api";

import type { HarnessClient } from "./harness-client.js";

export interface SessionDirectoryReporter {
  report(): void;
}

function fingerprint(entries: readonly SessionDirectoryEntry[]): string {
  return entries
    .map((e) => `${e.sessionId}|${e.mode}|${e.type}|${e.createdAt}`)
    .sort()
    .join("\n");
}

export function createSessionDirectoryReporter(deps: {
  client: HarnessClient;
  readSessions: () => readonly SessionDirectoryEntry[];
  debounceMs: number;
  log: (msg: string) => void;
}): SessionDirectoryReporter {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let reported: string | undefined;
  let attempted = new Set<string>();

  const schedule = (): void => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      void send();
    }, deps.debounceMs);
    timer.unref?.();
  };

  const send = async (): Promise<void> => {
    if (inFlight) {
      schedule();
      return;
    }
    const sessions = [...deps.readSessions()];
    const current = fingerprint(sessions);
    attempted = new Set(sessions.map((s) => s.sessionId));
    if (current === reported) return;
    inFlight = true;
    try {
      await deps.client.sessionDirectory.v1.report.mutate({
        protocolVersion: "v1",
        sessions,
      });
      reported = current;
    } catch (err) {
      deps.log(
        `[runtime] session directory report failed: ${(err as Error).message}`,
      );
    } finally {
      inFlight = false;
    }
  };

  /**
   * UNIT_BOUNDARY_DESCRIPTION: a Session the last report did not name goes
   * out at once, because the spend ledger checks a call's Session against the
   * directory when the call's first record arrives.
   */
  const report = (): void => {
    const fresh = deps.readSessions().some((s) => !attempted.has(s.sessionId));
    if (fresh) void send();
    else schedule();
  };

  return { report };
}
