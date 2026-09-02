import { describe, expect, it, vi } from "vitest";
import type { SessionDirectoryEntry } from "agent-runtime-api";

import type { HarnessClient } from "../../modules/runtime-channel/harness-client.js";
import { createSessionDirectoryReporter } from "../../modules/runtime-channel/session-directory-report.js";

function fakeClient(): { client: HarnessClient; sent: unknown[] } {
  const sent: unknown[] = [];
  const client = {
    sessionDirectory: {
      v1: {
        report: { mutate: async (input: unknown) => void sent.push(input) },
      },
    },
  } as unknown as HarnessClient;
  return { client, sent };
}

const session = (sessionId: string): SessionDirectoryEntry => ({
  sessionId,
  mode: "chat",
  type: "regular",
  createdAt: "2026-08-27T10:00:00.000Z",
});

describe("session directory reporter", () => {
  it("reports a changed snapshot but stays silent on an unchanged one", async () => {
    vi.useFakeTimers();
    const { client, sent } = fakeClient();
    let sessions = [session("s1")];
    const reporter = createSessionDirectoryReporter({
      client,
      readSessions: () => sessions,
      debounceMs: 10,
      log: () => {},
    });

    reporter.report();
    await vi.advanceTimersByTimeAsync(20);
    reporter.report();
    await vi.advanceTimersByTimeAsync(20);
    expect(sent).toHaveLength(1);

    sessions = [session("s1"), session("s2")];
    reporter.report();
    await vi.advanceTimersByTimeAsync(20);
    expect(sent).toHaveLength(2);

    vi.useRealTimers();
  });
});
