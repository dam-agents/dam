import type { SessionDirectoryEntry } from "agent-runtime-api";

import type { HarnessClient } from "./harness-client.js";
import { safeReport } from "./infrastructure/report.js";

export interface SessionDirectoryReporter {
  report(): void;
  registered(sessionId: string, timeoutMs: number): Promise<boolean>;
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
  let resend = false;
  const confirmed = new Set<string>();
  const waiters = new Map<string, Set<(ok: boolean) => void>>();

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
      resend = true;
      return;
    }
    const sessions = [...deps.readSessions()];
    const current = fingerprint(sessions);
    attempted = new Set(sessions.map((s) => s.sessionId));
    if (current === reported) return;
    inFlight = true;
    const sent = await safeReport(
      () =>
        deps.client.sessionDirectory.v1.report.mutate({
          protocolVersion: "v1",
          sessions,
        }),
      deps.log,
      "[runtime] session directory report",
    );
    inFlight = false;
    if (sent) {
      reported = current;
      for (const { sessionId } of sessions) {
        confirmed.add(sessionId);
        for (const resolve of waiters.get(sessionId) ?? []) resolve(true);
        waiters.delete(sessionId);
      }
    }
    if (resend) {
      resend = false;
      report();
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

  /**
   * UNIT_BOUNDARY_DESCRIPTION: whether the directory holds a Session, which a
   * new Session's first prompt waits for, so its first model call finds it
   * there. A report that fails or takes longer than the timeout lets the
   * prompt go anyway: the spend ledger books such calls to the Session later.
   */
  const registered = (
    sessionId: string,
    timeoutMs: number,
  ): Promise<boolean> => {
    if (confirmed.has(sessionId)) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (ok: boolean): void => {
        clearTimeout(timer);
        waiters.get(sessionId)?.delete(done);
        resolve(ok);
      };
      const timer = setTimeout(() => done(false), timeoutMs);
      timer.unref?.();
      waiters.set(sessionId, (waiters.get(sessionId) ?? new Set()).add(done));
      report();
    });
  };

  return { report, registered };
}
