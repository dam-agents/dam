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
    recordSender: () => {},
    recordContinuation: () => {},
    sendersOf: () => [],
    recordVerdict: () => {},
    verdictsOf: () => [],
    recordCutToolCalls: () => {},
    cutToolCallsOf: () => [],
    copyAttribution: () => {},
    markUnstored: () => {},
    markStored: () => {},
    clearFireEvent: () => {},
    all: () => ({}),
    adopt: () => {},
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
    signal: () => {},
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
      subAgentContextOf: () => ({ harness: "claude-code", inherited: {} }),
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

  // TEST_SCENARIO: the sessions list shows a badge per repository a session touched, with its pull request; the list carries what the changes module recorded for each session, and nothing for a session that edited no repository.
  it("carries the repositories each session touched", async () => {
    const { caller } = pagedHarness();
    const touched = {
      name: "acme/app",
      path: "/home/agent/work/app",
      branch: "feat/x",
      pullRequest: { number: 7, url: "https://github.com/acme/app/pull/7" },
    };
    const service = createSessionsService({
      subAgentContextOf: () => ({ harness: "claude-code", inherited: {} }),
      openCaller: () => caller,
      sessionMetadata: fakeStore(),
      isRunning: () => false,
      changes: createSessionChanges(0),
      sessionFrames: () => ({ frames: [], truncated: false }),
      delegations: { store: () => ({ truncated: false }), read: () => null },
      sessionRepositories: (sessionId) =>
        sessionId === "newer" ? [touched] : [],
      log: () => {},
    });

    const { sessions } = await service.list();

    expect(sessions.find((s) => s.sessionId === "newer")?.repositories).toEqual(
      [touched],
    );
    expect(sessions.find((s) => s.sessionId === "older")).not.toHaveProperty(
      "repositories",
    );
  });

  // TEST_SCENARIO: the first list after a boot starts the harness cold; the platform's own session records answer within the grace, and the harness-only sessions follow through a change notice that keeps the listing it just read.
  it("answers from the platform's records when the harness is slow, then announces the rest", async () => {
    let answer: (v: unknown) => void = () => {};
    let listCalls = 0;
    const caller: InProcessCaller = {
      request: async <T>(method: string): Promise<T> => {
        if (method !== "session/list") return {} as T;
        listCalls++;
        return new Promise<T>((resolve) => {
          answer = resolve as (v: unknown) => void;
        });
      },
      notify: () => {},
      signal: () => {},
      close: () => {},
    };
    const changes = createSessionChanges(0);
    const notices: number[] = [];
    changes.subscribe(() => notices.push(1));
    const store = fakeStore();
    store.all = () => ({
      platform: {
        meta: { mode: "chat" },
        createdAt: "2026-08-27T10:00:00.000Z",
      },
    });
    const service = createSessionsService({
      subAgentContextOf: () => ({ harness: "claude-code", inherited: {} }),
      openCaller: () => caller,
      sessionMetadata: store,
      isRunning: () => false,
      changes,
      sessionFrames: () => ({ frames: [], truncated: false }),
      delegations: { store: () => ({ truncated: false }), read: () => null },
      log: () => {},
    });

    const first = service.list();
    await vi.advanceTimersByTimeAsync(300);
    const early = await first;
    expect(early.sessions.map((s) => s.sessionId)).toEqual(["platform"]);
    expect(early.incomplete).toBe(true);
    expect(notices).toHaveLength(0);

    answer({
      sessions: [
        { sessionId: "terminal", updatedAt: "2026-08-27T11:00:00.000Z" },
      ],
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(notices).toHaveLength(1);

    const second = await service.list();
    expect(second.sessions.map((s) => s.sessionId).sort()).toEqual([
      "platform",
      "terminal",
    ]);
    expect(second.incomplete).toBeUndefined();
    expect(listCalls).toBe(1);
  });
  // TEST_SCENARIO: the harness listing reaches the service through the runtime's own session/list, which already shows a renamed session under its custom title. The automatic title the runtime passes beside it stays the automatic one, so the rename dialog's placeholder is not the custom title again.
  it("keeps the automatic title of a renamed session through the runtime's listing", async () => {
    const caller: InProcessCaller = {
      request: async <T>(method: string): Promise<T> => {
        if (method !== "session/list") return {} as T;
        return {
          sessions: [
            {
              sessionId: "renamed",
              title: "Daily brief",
              updatedAt: null,
              _meta: {
                platform: {
                  customTitle: "Daily brief",
                  autoTitle: "Summarize the open pull requests",
                },
              },
            },
          ],
        } as T;
      },
      notify: () => {},
      signal: () => {},
      close: () => {},
    };
    const store = fakeStore();
    store.all = () => ({
      renamed: {
        meta: { mode: "chat", customTitle: "Daily brief" },
        createdAt: "2026-08-27T10:00:00.000Z",
      },
    });
    const service = createSessionsService({
      subAgentContextOf: () => ({ harness: "claude-code", inherited: {} }),
      openCaller: () => caller,
      sessionMetadata: store,
      isRunning: () => false,
      changes: createSessionChanges(0),
      sessionFrames: () => ({ frames: [], truncated: false }),
      delegations: { store: () => ({ truncated: false }), read: () => null },
      log: () => {},
    });

    const { sessions } = await service.list();
    expect(sessions[0]).toMatchObject({
      title: "Daily brief",
      customTitle: "Daily brief",
      autoTitle: "Summarize the open pull requests",
    });
  });

  // TEST_SCENARIO: the agent renames its own session through the platform tool, which knows the session only by its reference; clearing the title hands the row back to the harness's title.
  it("sets a title on the session a reference names, and clears it with null", async () => {
    const entries: Record<string, SessionMetaEntry> = {
      s1: { meta: { mode: "chat", ref: "ref-1" }, createdAt: "2026-10-08" },
    };
    const service = createSessionsService({
      subAgentContextOf: () => ({ harness: "claude-code", inherited: {} }),
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

    // TEST_SCENARIO: the api-server reads a session's settings by its ref when the session spawns a platform sub-agent; a session with none answers empty settings, an untracked ref null.
    expect((await service.settings({ ref: "ref-1" }))?.settings).toEqual({});
    entries.s1 = {
      ...entries.s1!,
      meta: { ...entries.s1!.meta, settings: { subagentModel: "ibm/gpt-5.5" } },
    };
    expect((await service.settings({ ref: "ref-1" }))?.settings).toEqual({
      subagentModel: "ibm/gpt-5.5",
    });
    expect(await service.settings({ ref: "gone" })).toBeNull();
  });

  // TEST_SCENARIO: a session only the harness lists, such as one started from a shell in the pod, has no platform record yet; renaming it from the UI must work, so it gets a terminal record carrying the title, while an id the harness does not list stays refused.
  it("renames a session only the harness lists, and refuses an unknown one", async () => {
    const entries: Record<string, SessionMetaEntry> = {};
    const service = createSessionsService({
      subAgentContextOf: () => ({ harness: "claude-code", inherited: {} }),
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

describe("adoptHarnessTitle", () => {
  function titled(meta: SessionMetaEntry["meta"], failedOpens = 0) {
    const entries = new Map<string, SessionMetaEntry>([
      ["term", { meta, createdAt: "2026-10-20T00:00:00.000Z" }],
    ]);
    const asked: unknown[] = [];
    const caller: InProcessCaller = {
      request: async <T>(method: string, params: unknown): Promise<T> => {
        if (method !== "session/list") return {} as T;
        asked.push(params);
        return {
          sessions: [{ sessionId: "term", title: "fix the login\nmore" }],
        } as T;
      },
      notify: () => {},
      signal: () => {},
      close: () => {},
    };
    const service = createSessionsService({
      defaultHarness: "claude-code",
      subAgentContextOf: () => ({ harness: "claude-code", inherited: {} }),
      openCaller: () => {
        if (failedOpens-- > 0) throw new Error("the runtime is closed");
        return caller;
      },
      sessionMetadata: {
        ...fakeStore(),
        get: (id) => entries.get(id),
        set: (id, m) => {
          entries.set(id, { ...entries.get(id)!, meta: m });
        },
      },
      isRunning: () => false,
      changes: createSessionChanges(0),
      sessionFrames: () => ({ frames: [], truncated: false }),
      delegations: { store: () => ({ truncated: false }), read: () => null },
      log: () => {},
    });
    return { service, asked, meta: () => entries.get("term")?.meta };
  }

  // TEST_SCENARIO: A terminal Session sends no prompt, so its title is the one its own harness lists; the list is asked of that harness, and the first line is kept as the Session's title.
  it("keeps the harness's title for a terminal session", async () => {
    const t = titled({ mode: "terminal", harness: "copilot" });
    await t.service.adoptHarnessTitle("term");
    expect(t.asked).toEqual([
      { cwd: ".", _meta: { platform: { harness: "copilot" } } },
    ]);
    expect(t.meta()?.title).toBe("fix the login");
  });

  // TEST_SCENARIO: A title a person set wins over the harness's, and a chat Session already takes its title from its first prompt, so neither asks the harness.
  it("leaves a set title and a chat session alone", async () => {
    for (const meta of [
      { mode: "terminal", customTitle: "mine" },
      { mode: "chat" },
    ]) {
      const t = titled(meta);
      await t.service.adoptHarnessTitle("term");
      expect(t.asked).toEqual([]);
      expect(t.meta()?.title).toBeUndefined();
    }
  });

  // TEST_SCENARIO: No channel to the harness opens; the read fails without throwing, and the next read of the same Session asks again.
  it("asks again after no channel to the harness opened", async () => {
    const t = titled({ mode: "terminal", harness: "copilot" }, 1);
    await expect(t.service.adoptHarnessTitle("term")).resolves.toBeUndefined();
    expect(t.meta()?.title).toBeUndefined();
    await t.service.adoptHarnessTitle("term");
    expect(t.meta()?.title).toBe("fix the login");
  });
});

describe("adoptHarnessTitles", () => {
  type Listed = { sessionId: string; title?: string };
  function booted(
    listings: Record<string, Listed[] | Listed[][] | Error>,
    failedOpens = 0,
  ) {
    const entries = new Map<string, SessionMetaEntry>([
      [
        "old",
        {
          meta: { mode: "chat" },
          createdAt: "2026-10-01T00:00:00.000Z",
        },
      ],
      [
        "named",
        {
          meta: { mode: "chat", harness: "claude-code", title: "kept" },
          createdAt: "2026-10-02T00:00:00.000Z",
        },
      ],
      [
        "renamed",
        {
          meta: { mode: "chat", harness: "claude-code", customTitle: "mine" },
          createdAt: "2026-10-03T00:00:00.000Z",
        },
      ],
      [
        "codex-session",
        {
          meta: { mode: "chat", harness: "codex" },
          createdAt: "2026-10-04T00:00:00.000Z",
        },
      ],
    ]);
    const asked: { _meta?: { platform?: { harness?: string } } }[] = [];
    const caller: InProcessCaller = {
      request: async <T>(method: string, params: unknown): Promise<T> => {
        if (method !== "session/list") return {} as T;
        const harness = (
          params as { _meta?: { platform?: { harness?: string } } }
        )._meta?.platform?.harness;
        if (harness === undefined) return { sessions: [] } as T;
        asked.push(params as { _meta?: { platform?: { harness?: string } } });
        const listing = listings[harness] ?? [];
        if (listing instanceof Error) throw listing;
        const pages = (
          Array.isArray(listing[0]) ? listing : [listing]
        ) as Listed[][];
        const page = Number((params as { cursor?: string }).cursor ?? 0);
        return {
          sessions: pages[page],
          nextCursor: page + 1 < pages.length ? String(page + 1) : null,
        } as T;
      },
      notify: () => {},
      signal: () => {},
      close: () => {},
    };
    const service = createSessionsService({
      defaultHarness: "claude-code",
      subAgentContextOf: () => ({ harness: "claude-code", inherited: {} }),
      openCaller: () => {
        if (failedOpens-- > 0) throw new Error("the runtime is closed");
        return caller;
      },
      sessionMetadata: {
        ...fakeStore(),
        all: () => Object.fromEntries(entries),
        get: (id) => entries.get(id),
        set: (id, m) => {
          entries.set(id, { ...entries.get(id)!, meta: m });
        },
      },
      isRunning: () => false,
      changes: createSessionChanges(0),
      sessionFrames: () => ({ frames: [], truncated: false }),
      delegations: { store: () => ({ truncated: false }), read: () => null },
      log: () => {},
    });
    return { service, asked, meta: (id: string) => entries.get(id)?.meta };
  }

  // TEST_SCENARIO: Sessions an older runtime made carry no kept title; after a boot the runtime asks each harness for its own listing once and keeps the first line, so the list shows those Sessions with their harness's title again; a Session that records no harness is asked of the default one.
  it("keeps the harness's title for every untitled session", async () => {
    const t = booted({
      "claude-code": [
        { sessionId: "old", title: "fix the login\nand the logout" },
        { sessionId: "named", title: "the harness's" },
        { sessionId: "renamed", title: "the harness's" },
      ],
      codex: [{ sessionId: "codex-session", title: "port the hook" }],
    });

    await t.service.adoptHarnessTitles();

    expect(t.asked).toEqual([
      { cwd: ".", _meta: { platform: { harness: "claude-code" } } },
      { cwd: ".", _meta: { platform: { harness: "codex" } } },
    ]);
    expect(t.meta("old")?.title).toBe("fix the login");
    expect(t.meta("codex-session")?.title).toBe("port the hook");
    expect(t.meta("named")?.title).toBe("kept");
    expect(t.meta("renamed")).toEqual({
      mode: "chat",
      harness: "claude-code",
      customTitle: "mine",
    });

    const listed = (await t.service.list()).sessions.find(
      (s) => s.sessionId === "old",
    );
    expect(listed?.title).toBe("fix the login");
  });

  // TEST_SCENARIO: A harness with many sessions lists them over many pages; once every untitled session has its title, the runtime reads no further page.
  it("stops paging once every untitled session is found", async () => {
    const t = booted({
      "claude-code": [
        [{ sessionId: "named", title: "the harness's" }],
        [{ sessionId: "old", title: "fix the login" }],
        [{ sessionId: "older", title: "never read" }],
      ],
      codex: [{ sessionId: "codex-session", title: "port the hook" }],
    });

    await t.service.adoptHarnessTitles();

    expect(t.meta("old")?.title).toBe("fix the login");
    expect(t.asked).toEqual([
      { cwd: ".", _meta: { platform: { harness: "claude-code" } } },
      {
        cwd: ".",
        _meta: { platform: { harness: "claude-code" } },
        cursor: "1",
      },
      { cwd: ".", _meta: { platform: { harness: "codex" } } },
    ]);
  });

  // TEST_SCENARIO: One harness failing to answer must not stop the others; its sessions stay untitled and the next harness still gets its titles.
  it("keeps the other harness's titles when one listing fails", async () => {
    const t = booted({
      "claude-code": new Error("harness exited"),
      codex: [{ sessionId: "codex-session", title: "port the hook" }],
    });

    await t.service.adoptHarnessTitles();

    expect(t.meta("old")?.title).toBeUndefined();
    expect(t.meta("codex-session")?.title).toBe("port the hook");
  });

  // TEST_SCENARIO: No channel to the harnesses opens at boot; the backfill logs it and resolves, since a rejection there would end the runtime.
  it("resolves when no channel to the harnesses opens", async () => {
    const t = booted({}, 1);
    await expect(t.service.adoptHarnessTitles()).resolves.toBeUndefined();
    expect(t.asked).toEqual([]);
    expect(t.meta("old")?.title).toBeUndefined();
  });
});
