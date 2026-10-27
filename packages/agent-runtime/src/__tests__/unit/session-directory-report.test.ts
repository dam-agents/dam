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

  /** TEST_SCENARIO: A new Session's first prompt waits until the directory
   * holds the Session. A report that succeeds confirms it at once; while the
   * api-server cannot be reached, the wait ends at its timeout, unconfirmed,
   * so the prompt still goes. */
  it("confirms a reported Session and gives up at the timeout", async () => {
    vi.useFakeTimers();
    const { client } = fakeClient();
    const reporter = createSessionDirectoryReporter({
      client,
      readSessions: () => [session("s1")],
      debounceMs: 10,
      log: () => {},
    });
    await expect(reporter.registered("s1", 2_000)).resolves.toBe(true);

    const down = {
      sessionDirectory: {
        v1: {
          report: {
            mutate: async () => {
              throw new Error("unreachable");
            },
          },
        },
      },
    } as unknown as HarnessClient;
    const failing = createSessionDirectoryReporter({
      client: down,
      readSessions: () => [session("s2")],
      debounceMs: 10,
      log: () => {},
    });
    const waited = failing.registered("s2", 2_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(waited).resolves.toBe(false);

    vi.useRealTimers();
  });
});
