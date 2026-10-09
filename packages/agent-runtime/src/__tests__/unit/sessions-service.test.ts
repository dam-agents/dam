import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InProcessCaller } from "../../modules/acp/infrastructure/in-process-request.js";
import type {
  SessionMetaEntry,
  SessionMetadataStore,
} from "../../modules/acp/infrastructure/session-metadata-store.js";
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
    findByRef: () => undefined,
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
      sessionFrames: () => ({ frames: [], truncated: false }),
      delegations: { store: () => ({ truncated: false }), read: () => null },
      log: () => {},
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

  // TEST_SCENARIO: the agent renames its own session through the platform tool, which knows the session only by its reference; clearing the title hands the row back to the harness's title.
  it("sets a title on the session a reference names, and clears it with null", async () => {
    const entries: Record<string, SessionMetaEntry> = {
      s1: { meta: { mode: "chat", ref: "ref-1" }, createdAt: "2026-10-08" },
    };
    const service = createSessionsService({
      openCaller: () => pagedHarness().caller,
      sessionMetadata: {
        ...fakeStore(),
        get: (id) => entries[id],
        findByRef: (ref) =>
          Object.keys(entries).find((id) => entries[id]?.meta.ref === ref),
        set: (id, meta) => {
          entries[id] = { ...entries[id]!, meta };
        },
      },
      isRunning: () => false,
      changes: createSessionChanges(0),
      sessionFrames: () => ({ frames: [], truncated: false }),
      delegations: { store: () => ({ truncated: false }), read: () => null },
      log: () => {},
    });

    expect(
      await service.setTitle({ ref: "ref-1", title: "Release notes" }),
    ).toBe(true);
    expect(entries.s1?.meta).toEqual({
      mode: "chat",
      ref: "ref-1",
      customTitle: "Release notes",
    });
    await service.setTitle({ sessionId: "s1", title: null });
    expect(entries.s1?.meta).toEqual({ mode: "chat", ref: "ref-1" });
    expect(await service.setTitle({ ref: "gone", title: "x" })).toBe(false);
  });

  // TEST_SCENARIO: a session only the harness lists, such as one started from a shell in the pod, has no platform record yet; renaming it from the UI must work, so it gets a terminal record carrying the title, while an id the harness does not list stays refused.
  it("renames a session only the harness lists, and refuses an unknown one", async () => {
    const entries: Record<string, SessionMetaEntry> = {};
    const service = createSessionsService({
      openCaller: () => pagedHarness().caller,
      sessionMetadata: {
        ...fakeStore(),
        get: (id) => entries[id],
        set: (id, meta) => {
          entries[id] = { meta, createdAt: "2026-10-08" };
        },
      },
      isRunning: () => false,
      changes: createSessionChanges(0),
      sessionFrames: () => ({ frames: [], truncated: false }),
      delegations: { store: () => ({ truncated: false }), read: () => null },
      log: () => {},
    });

    expect(await service.setTitle({ sessionId: "older", title: "Notes" })).toBe(
      true,
    );
    expect(entries.older?.meta).toEqual({
      mode: "terminal",
      customTitle: "Notes",
    });
    expect(await service.setTitle({ sessionId: "unknown", title: "x" })).toBe(
      false,
    );
    expect(entries.unknown).toBeUndefined();
  });
});
