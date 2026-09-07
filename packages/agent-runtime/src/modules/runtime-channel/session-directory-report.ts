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

  return { report: schedule };
}
