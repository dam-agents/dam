import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InProcessCaller } from "../../modules/acp/infrastructure/in-process-request.js";
import type { SessionMetadataStore } from "../../modules/acp/infrastructure/session-metadata-store.js";
import { createSessionChanges } from "../../modules/acp/services/session-changes.js";
import { createSessionsService } from "../../modules/acp/services/sessions-service.js";

// TEST_OVERVIEW: the pod's session list read — it collects every page the harness serves and reuses that listing until a session change.

function fakeStore(): SessionMetadataStore {
  return {
    get: () => undefined,
    set: () => {},
    recordActivity: () => {},
    recordSeen: () => {},
    startRun: () => null,
    finishRun: () => {},
    runStartsOf: () => [],
    all: () => ({}),
    tombstone: () => {},
    isTombstoned: () => false,
  };
}

function pagedHarness() {
  const listCalls: unknown[] = [];
  const caller: InProcessCaller = {
    request: async <T>(method: string, params: unknown): Promise<T> => {
      if (method !== "session/list") return {} as T;
      listCalls.push(params);
      const cursor = (params as { cursor?: string }).cursor;
      return (
        cursor === "p2"
          ? {
              sessions: [
                { sessionId: "older", updatedAt: "2026-08-27T09:00:00.000Z" },
                { sessionId: "newer", updatedAt: "2026-08-27T11:00:00.000Z" },
              ],
            }
          : {
              sessions: [
                { sessionId: "newer", updatedAt: "2026-08-27T11:00:00.000Z" },
              ],
              nextCursor: "p2",
            }
      ) as T;
    },
    notify: () => {},
    close: () => {},
  };
  return { caller, listCalls };
}

describe("createSessionsService", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // TEST_SCENARIO: A harness like codex serves its session list 25 at a time; every page is read once, repeats across pages collapse, and later reads reuse the listing until a session change drops it.
  it("follows the harness cursor and reuses the listing until a session change", async () => {
    const { caller, listCalls } = pagedHarness();
    const changes = createSessionChanges(0);
    const service = createSessionsService({
      openCaller: () => caller,
      sessionMetadata: fakeStore(),
      isRunning: () => false,
      changes,
    });

    const first = await service.list();
    expect(first.sessions.map((s) => s.sessionId)).toEqual(["newer", "older"]);
    expect(listCalls).toHaveLength(2);

    await service.list({ limit: 1 });
    expect(listCalls).toHaveLength(2);

    changes.notify();
    vi.advanceTimersByTime(0);
    await service.list();
    expect(listCalls).toHaveLength(4);
  });
});
