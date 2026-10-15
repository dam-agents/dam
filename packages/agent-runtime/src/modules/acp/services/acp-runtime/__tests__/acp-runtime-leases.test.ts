import { describe, it, expect, afterEach, vi } from "vitest";
import { CONFIGURE_SESSION_METHOD, PIN_MODEL_METHOD } from "agent-runtime-api";
import {
  IDLE_REAP_DELAY_MS,
  createClient,
  createHarness,
  createInMemoryUndeliveredStore,
  createSessionMetadata,
  frames,
  memoryDocumentBackend,
  keepsEveryTask,
  promptTextsOf,
  type Frame,
  type Harness,
} from "./acp-world.js";
import { createAcpRuntime } from "../acp-runtime.js";
import { createActiveTurnStore } from "../../../infrastructure/active-turn-store.js";
import { createBackgroundWorkRegistry } from "../../background-work-registry.js";
import {
  createLeaseRouter,
  PROVIDER_REMOVED_REASON,
  type LeasePair,
} from "../../lease-router.js";

/**
 * TEST_OVERVIEW: one agent, several harness processes.
 *
 * A session runs on the harness and model provider it was started with, so
 * the runtime holds one harness process per (harness, provider) pair that a
 * session asks for. Each process sees only its own provider's env, so taking
 * one provider away must recycle only the processes on it, and a session on
 * a removed provider must say so instead of running somewhere else. One client
 * connection reaches every process, so a question two harnesses ask with the
 * same request id must still be answered to the harness that asked it.
 */

const IDLE_CHECK_MS = 10_000;

const SESSION_SETTINGS: Record<string, "process" | "session"> = {
  mode: "session",
  cacheTtl: "process",
};

function createLeaseWorld(opts: { providers: string[] }) {
  let providers = opts.providers;
  let keptProcesses = 0;
  const metadata = createSessionMetadata();
  const harnesses = new Map<string, Harness[]>();
  const key = (pair: LeasePair): string =>
    `${pair.harness}/${pair.provider ?? "-"}${pair.model ? `/${pair.model}` : ""}${pair.settings?.cacheTtl ? `/cache-${pair.settings.cacheTtl}` : ""}`;
  const backgroundWork = createBackgroundWorkRegistry({
    keepPolicy: keepsEveryTask,
  });
  const router = createLeaseRouter({
    defaultHarness: "claude-code",
    harnessKnown: (h) => ["claude-code", "codex"].includes(h),
    providers: () => providers,
    settingScope: (_harness, id) => SESSION_SETTINGS[id] ?? null,
    settingsError: (_harness, settings) =>
      Object.keys(settings).some((id) => !SESSION_SETTINGS[id])
        ? "unsupported setting"
        : undefined,
    sessionMetadata: metadata.store,
    backgroundWork,
    keepPolicy: { keptProcessCount: () => keptProcesses },
    idleCheckMs: IDLE_CHECK_MS,
    log: () => {},
    createRuntime: (pair, scoped) =>
      createAcpRuntime({
        workingDir: "/workspace",
        idleReapDelayMs: IDLE_REAP_DELAY_MS,
        onArtifactTouch: () => {},
        undeliveredPrompts: createInMemoryUndeliveredStore(),
        activeTurns: createActiveTurnStore(memoryDocumentBackend()),
        sessionMetadata: metadata.store,
        backgroundWork: scoped.backgroundWork,
        onHarnessExited: scoped.onHarnessExited,
        modeSettingId: "mode",
        sessionSettingFrames: (sessionId) => {
          const mode = metadata.store.get(sessionId)?.meta.settings?.mode;
          return mode
            ? [
                {
                  method: "session/set_mode",
                  params: { sessionId, modeId: mode },
                },
              ]
            : [];
        },
        spawnAgent: () => {
          scoped.harnessSpawned();
          const { harness, process } = createHarness();
          const spawnedAs = key(scoped.pair());
          const list = harnesses.get(spawnedAs) ?? [];
          list.push(harness);
          harnesses.set(spawnedAs, list);
          return process;
        },
      }),
  });
  return {
    router,
    metadata,
    backgroundWork,
    connect() {
      const { client, channel } = createClient();
      router.attach(channel);
      return client;
    },
    harness(k: string): Harness {
      const list = harnesses.get(k);
      const last = list?.[list.length - 1];
      if (!last) throw new Error(`no harness was started for ${k}`);
      return last;
    },
    harnessCount: (k: string) => harnesses.get(k)?.length ?? 0,
    keepProcesses(count: number) {
      keptProcesses = count;
    },
    grantAhead(provider: string) {
      providers = [provider, ...providers];
    },
    revoke(provider: string) {
      providers = providers.filter((p) => p !== provider);
      router.applyEnvChange({
        namesChanged: true,
        base: null,
        providers: [{ id: provider, namesChanged: true }],
        harnesses: [],
      });
    },
  };
}

function newSessionOn(id: number, platform: Record<string, string>): object {
  return {
    jsonrpc: "2.0",
    id,
    method: "session/new",
    params: { cwd: ".", _meta: { platform } },
  };
}

function startSession(
  world: ReturnType<typeof createLeaseWorld>,
  client: ReturnType<typeof createLeaseWorld>["connect"] extends () => infer C
    ? C
    : never,
  harnessKey: string,
  sessionId: string,
  id: number,
  platform: Record<string, string>,
): void {
  client.send(newSessionOn(id, platform));
  world.harness(harnessKey).replyTo("session/new", { sessionId });
}

describe("acp-runtime: one harness process per (harness, provider)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** TEST_SCENARIO: A session on the default pair and one on a second provider
   * each reach their own harness process, and the second process is started
   * only when a session first asks for it. */
  it("runs each session on the process for its own pair", () => {
    const world = createLeaseWorld({ providers: ["conn-a", "conn-b"] });
    const client = world.connect();
    client.send(frames.initialize(1));
    world.harness("claude-code/conn-a").replyTo("initialize", {});
    expect(world.harnessCount("claude-code/conn-b")).toBe(0);

    startSession(world, client, "claude-code/conn-a", "s-a", 2, {});
    startSession(world, client, "claude-code/conn-b", "s-b", 3, {
      harness: "claude-code",
      provider: "conn-b",
    });

    client.send(frames.prompt(4, "s-b", "on b"));
    client.send(frames.prompt(5, "s-a", "on a"));
    expect(promptTextsOf(world.harness("claude-code/conn-b"))).toEqual([
      "on b",
    ]);
    expect(promptTextsOf(world.harness("claude-code/conn-a"))).toEqual([
      "on a",
    ]);
    expect(world.metadata.store.get("s-b")?.meta).toMatchObject({
      harness: "claude-code",
      provider: "conn-b",
    });
  });

  /** TEST_SCENARIO: A prestart starts only the default pair's process, which
   * every client's initialize reaches, so the first client finds it running
   * and no other process is started before a session asks for one. */
  it("prestarts the default pair's process only", () => {
    const world = createLeaseWorld({ providers: ["conn-a", "conn-b"] });
    world.router.prestart();
    expect(world.harnessCount("claude-code/conn-a")).toBe(1);
    expect(world.harnessCount("claude-code/conn-b")).toBe(0);

    world.connect().send(frames.initialize(1));
    expect(world.harnessCount("claude-code/conn-a")).toBe(1);
    expect(world.harness("claude-code/conn-a").receivedMethods()).toEqual([
      "initialize",
    ]);
  });

  /** TEST_SCENARIO: The second process is told about the client the same way
   * the first was, so it answers with the same client capabilities, and its
   * own initialize answer never reaches the client a second time. */
  it("replays the client's own initialize into a process it reaches later", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const client = world.connect();
    client.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: 1, clientCapabilities: { terminal: true } },
    });
    world.harness("claude-code/conn-a").replyTo("initialize", {});
    client.send(newSessionOn(2, { harness: "codex", model: "gpt-5" }));
    const codex = world.harness("codex/conn-a/gpt-5");
    expect(codex.received("initialize")[0]?.params).toEqual({
      protocolVersion: 1,
      clientCapabilities: { terminal: true },
    });
    codex.replyTo("initialize", {});
    expect(client.saw("initialize")).toEqual([]);
    expect(client.reply(1)).toBeDefined();
  });

  /** TEST_SCENARIO: Two harnesses ask the client a question with the same
   * request id. Each answer reaches the harness that asked it. */
  it("keeps agent requests from two processes apart", () => {
    const world = createLeaseWorld({ providers: ["conn-a", "conn-b"] });
    const client = world.connect();
    startSession(world, client, "claude-code/conn-a", "s-a", 1, {});
    startSession(world, client, "claude-code/conn-b", "s-b", 2, {
      provider: "conn-b",
    });
    world
      .harness("claude-code/conn-a")
      .emit(frames.requestPermission(0, "s-a"));
    world
      .harness("claude-code/conn-b")
      .emit(frames.requestPermission(0, "s-b"));
    const asked = client.saw("session/request_permission");
    expect(asked).toHaveLength(2);
    const [toA, toB] = asked as [Frame, Frame];
    expect(toA.id).not.toEqual(toB.id);

    client.send({ jsonrpc: "2.0", id: toB.id, result: { outcome: "b" } });
    client.send({ jsonrpc: "2.0", id: toA.id, result: { outcome: "a" } });
    expect(world.harness("claude-code/conn-a").answersTo(0)).toEqual([
      expect.objectContaining({ result: { outcome: "a" } }),
    ]);
    expect(world.harness("claude-code/conn-b").answersTo(0)).toEqual([
      expect.objectContaining({ result: { outcome: "b" } }),
    ]);
  });

  /** TEST_SCENARIO: A permission prompt is still open when the page reloads,
   * so the runtime puts the same question before the new connection. It
   * reaches the client under the id the first connection saw, which is what
   * lets the platform resolve the approval it already recorded for it rather
   * than leave that one pending beside a second. */
  it("puts a re-sent question before a new client under the id it had", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const first = world.connect();
    startSession(world, first, "claude-code/conn-a", "s-a", 1, {});
    first.send(frames.prompt(2, "s-a", "write a file"));
    world
      .harness("claude-code/conn-a")
      .emit(frames.requestPermission(7, "s-a"));
    const [asked] = first.saw("session/request_permission") as [Frame];

    const reloaded = world.connect();
    reloaded.send(frames.loadSession(1, "s-a"));
    const [reasked] = reloaded.saw("session/request_permission") as [Frame];
    expect(reasked.id).toEqual(asked.id);

    reloaded.send({ jsonrpc: "2.0", id: reasked.id, result: { outcome: "x" } });
    expect(world.harness("claude-code/conn-a").answersTo(7)).toEqual([
      expect.objectContaining({ result: { outcome: "x" } }),
    ]);
  });

  /** TEST_SCENARIO: A recycle restarts the harness inside the same lease, and
   * the new process counts its request ids from the start again. Its question
   * must not reach the client under the id of one from the process before,
   * which the platform could take for an approval it already recorded. */
  it("never gives a restarted harness's question the id of an earlier one", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const client = world.connect();
    startSession(world, client, "claude-code/conn-a", "s-a", 1, {});
    world
      .harness("claude-code/conn-a")
      .emit(frames.requestPermission(7, "s-a"));
    const [before] = client.saw("session/request_permission") as [Frame];
    client.send({ jsonrpc: "2.0", id: before.id, result: { outcome: "x" } });

    world.router.recycleHarness("claude-code");
    const reconnected = world.connect();
    startSession(world, reconnected, "claude-code/conn-a", "s-b", 1, {});
    expect(world.harnessCount("claude-code/conn-a")).toBe(2);
    world
      .harness("claude-code/conn-a")
      .emit(frames.requestPermission(7, "s-b"));
    const [after] = reconnected.saw("session/request_permission") as [Frame];
    expect(after.id).not.toEqual(before.id);
  });

  /** TEST_SCENARIO: Taking provider B away shuts B's process down rather than
   * restarting it without a credential, leaves A's running, and closes the
   * client that used B, so a turn it still shows as running ends. Reopening
   * B's session starts no process on credentials B no longer has, and
   * prompting it fails naming the provider. */
  it("shuts down only the removed provider's process and refuses its sessions", () => {
    const world = createLeaseWorld({ providers: ["conn-a", "conn-b"] });
    const client = world.connect();
    startSession(world, client, "claude-code/conn-a", "s-a", 1, {});
    startSession(world, client, "claude-code/conn-b", "s-b", 2, {
      provider: "conn-b",
    });

    world.revoke("conn-b");
    expect(world.harness("claude-code/conn-b").killed()).toBe(true);
    expect(world.harness("claude-code/conn-a").killed()).toBe(false);
    expect(client.isOpen()).toBe(false);
    expect(world.router.leases().map((l) => l.provider)).toEqual(["conn-a"]);

    const fresh = world.connect();
    fresh.send({
      jsonrpc: "2.0",
      id: 6,
      method: "session/resume",
      params: { sessionId: "s-b", cwd: "." },
    });
    expect(world.harnessCount("claude-code/conn-b")).toBe(1);
    fresh.send(frames.prompt(7, "s-b", "still there?"));
    expect(fresh.reply(7)?.error).toMatchObject({
      data: {
        platform: { reason: PROVIDER_REMOVED_REASON, provider: "conn-b" },
      },
    });
    fresh.send(frames.prompt(8, "s-a", "fine"));
    expect(promptTextsOf(world.harness("claude-code/conn-a"))).toEqual([
      "fine",
    ]);
  });

  /** TEST_SCENARIO: A session started before sessions carried a pair keeps the
   * provider it first ran on, even after a newer provider is granted ahead of
   * it, and a later metadata write does not lose that pair. */
  it("keeps a session without a pair on the provider it first ran on", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    world.metadata.store.set("old", { mode: "chat" });
    const client = world.connect();
    client.send(frames.prompt(1, "old", "hello"));
    expect(world.metadata.store.get("old")?.meta).toMatchObject({
      harness: "claude-code",
      provider: "conn-a",
    });
    world.metadata.store.set("old", { mode: "terminal" });
    expect(world.metadata.store.get("old")?.meta.provider).toBe("conn-a");

    world
      .harness("claude-code/conn-a")
      .replyTo("session/prompt", { stopReason: "end_turn" });
    world.grantAhead("conn-0");
    client.send(frames.prompt(2, "old", "again"));
    expect(promptTextsOf(world.harness("claude-code/conn-a"))).toEqual([
      "hello",
      "again",
    ]);
    expect(world.harnessCount("claude-code/conn-0")).toBe(0);
  });

  /** TEST_SCENARIO: A session started while the agent had no provider runs
   * without one, and takes the first provider once one is granted, instead of
   * staying on a process that has no model access. */
  it("moves a session started without a provider to the first one granted", () => {
    const world = createLeaseWorld({ providers: [] });
    const client = world.connect();
    startSession(world, client, "claude-code/-", "s", 1, {
      harness: "claude-code",
    });
    world.grantAhead("conn-a");
    client.send(frames.prompt(2, "s", "now with a provider"));
    expect(promptTextsOf(world.harness("claude-code/conn-a"))).toEqual([
      "now with a provider",
    ]);
    expect(world.metadata.store.get("s")?.meta).toMatchObject({
      harness: "claude-code",
      provider: "conn-a",
    });
  });

  /** TEST_SCENARIO: A client connects before the agent's first provider has
   * reached the pod, so it lands on a lease with no provider. When the
   * provider arrives, that lease becomes the default one and restarts its
   * process on that provider's env, so the next session runs with the
   * provider's credentials; no second lease opens, so the client and the next
   * session meet on the same lease. */
  it("lets the provider-less default lease take the first provider", () => {
    const world = createLeaseWorld({ providers: [] });
    const client = world.connect();
    client.send(frames.initialize(1));
    const early = world.harness("claude-code/-");
    early.replyTo("initialize", {});

    world.grantAhead("conn-a");
    world.router.applyEnvChange({
      namesChanged: true,
      base: null,
      providers: [{ id: "conn-a", namesChanged: true }],
      harnesses: [],
    });
    expect(world.router.leases()).toEqual([
      { harness: "claude-code", provider: "conn-a", model: null },
    ]);

    expect(early.killed()).toBe(true);
    world.connect().send(newSessionOn(2, {}));
    expect(
      world.harness("claude-code/conn-a").received("session/new"),
    ).toHaveLength(1);
    expect(world.harnessCount("claude-code/-")).toBe(1);
  });

  /** TEST_SCENARIO: A session whose harness this agent no longer carries is
   * refused with a clear error, not run on another harness. */
  it("refuses a session on a harness the agent does not carry", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    world.metadata.store.set("gone", {
      mode: "chat",
      harness: "gemini",
      provider: "conn-a",
    });
    const client = world.connect();
    client.send(frames.prompt(1, "gone", "hello"));
    expect(client.reply(1)?.error).toMatchObject({ code: -32602 });
    expect(promptTextsOf(world.harness("claude-code/conn-a"))).toEqual([]);
  });

  /** TEST_SCENARIO: Every client connection is attached to the default
   * provider's process. Rotating that provider's credential restarts the
   * process and closes the connections that used it, and keeps open a
   * connection that used only another provider. */
  it("closes only the clients that used a restarted process", () => {
    const world = createLeaseWorld({ providers: ["conn-a", "conn-b"] });
    const onA = world.connect();
    const onB = world.connect();
    startSession(world, onA, "claude-code/conn-a", "s-a", 1, {});
    startSession(world, onB, "claude-code/conn-b", "s-b", 2, {
      provider: "conn-b",
    });
    world.router.applyEnvChange({
      namesChanged: true,
      base: null,
      providers: [{ id: "conn-a", namesChanged: true }],
      harnesses: [],
    });
    world.harness("claude-code/conn-a").exit();
    expect(onA.isOpen()).toBe(false);
    expect(onB.isOpen()).toBe(true);
  });
  /** TEST_SCENARIO: The default pair's harness dies, as from an
   * out-of-memory kill, while the runtime itself keeps running. The next
   * session starts a new harness process instead of hanging on the dead one,
   * and so does a client that connected before that session asked. */
  it("respawns the default pair's process for the next session after its harness died", async () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const before = world.connect();
    startSession(world, before, "claude-code/conn-a", "s-a", 1, {});

    world.harness("claude-code/conn-a").exit();
    await Promise.resolve();
    expect(before.isOpen()).toBe(false);

    const early = world.connect();
    const late = world.connect();
    startSession(world, late, "claude-code/conn-a", "s-b", 2, {});
    expect(world.harnessCount("claude-code/conn-a")).toBe(2);
    expect(late.reply(2)).toMatchObject({ result: { sessionId: "s-b" } });
    late.send(frames.prompt(3, "s-b", "after the crash"));
    expect(promptTextsOf(world.harness("claude-code/conn-a"))).toEqual([
      "after the crash",
    ]);

    early.send(frames.prompt(4, "s-a", "on the old session"));
    expect(early.isOpen()).toBe(true);
    expect(world.harnessCount("claude-code/conn-a")).toBe(2);
  });

  /** TEST_SCENARIO: A connection that never opened a session, such as one
   * that only makes control calls, keeps its connection when an env change
   * restarts the default process. The restart waits a bounded time for a
   * request in flight; a request the harness never answers is then answered
   * with the restart reason, so the caller does not wait forever. Its next
   * request reaches a new process. */
  it("answers a sessionless request cut off by a restart, and serves the next one", () => {
    vi.useFakeTimers();
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const client = world.connect();
    client.send(frames.initialize(1));
    world.harness("claude-code/conn-a").replyTo("initialize", {});
    const control = (id: number) => ({
      jsonrpc: "2.0",
      id,
      method: "control/getEnv",
      params: {},
    });
    client.send(control(2));

    world.router.refreshEnv({ force: false });
    expect(client.reply(2)).toBeUndefined();
    vi.advanceTimersByTime(10_000);

    expect(client.reply(2)).toMatchObject({
      error: { message: "agent recycled for env change" },
    });
    expect(client.isOpen()).toBe(true);
    client.send(control(3));
    expect(world.harnessCount("claude-code/conn-a")).toBe(2);
    expect(
      world.harness("claude-code/conn-a").received("control/getEnv"),
    ).toHaveLength(1);
  });
  /** TEST_SCENARIO: A model that a harness chose from the provider's env is
   * stale once that env changes, so an idle process holding such a model is
   * shut down, and the next session opens a fresh one. */
  it("reopens a lease that chose its model from a changed env", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const client = world.connect();
    startSession(world, client, "codex/conn-a", "s-c", 1, {
      harness: "codex",
    });
    const first = world.harness("codex/conn-a");
    world.router.applyEnvChange({
      namesChanged: false,
      base: null,
      providers: [{ id: "conn-a", namesChanged: false }],
      harnesses: [],
    });
    expect(first.killed()).toBe(true);
    startSession(world, client, "codex/conn-a", "s-c2", 2, {
      harness: "codex",
    });
    expect(world.harnessCount("codex/conn-a")).toBe(2);
  });

  /** TEST_SCENARIO: A process other than the default one goes away once no
   * session needs it, and the client connection that used it stays open. */
  it("shuts down a lease once no client holds a session on it", () => {
    vi.useFakeTimers();
    const world = createLeaseWorld({ providers: ["conn-a", "conn-b"] });
    const client = world.connect();
    startSession(world, client, "claude-code/conn-b", "s-b", 1, {
      provider: "conn-b",
    });
    client.send(frames.prompt(2, "s-b", "work"));
    const b = world.harness("claude-code/conn-b");
    vi.advanceTimersByTime(IDLE_CHECK_MS);
    expect(b.killed()).toBe(false);

    b.replyTo("session/prompt", { stopReason: "end_turn" });
    client.disconnect();
    vi.advanceTimersByTime(IDLE_REAP_DELAY_MS + IDLE_CHECK_MS);
    expect(b.killed()).toBe(true);
    expect(world.router.leases().map((l) => l.provider)).toEqual(["conn-a"]);

    const other = world.connect();
    startSession(world, other, "claude-code/conn-b", "s-b2", 3, {
      provider: "conn-b",
    });
    vi.advanceTimersByTime(IDLE_CHECK_MS);
    expect(other.isOpen()).toBe(true);
  });

  /** TEST_SCENARIO: A process is not shut down while a session it is opening
   * has no answer yet. */
  it("keeps a lease whose first session is still opening", () => {
    vi.useFakeTimers();
    const world = createLeaseWorld({ providers: ["conn-a", "conn-b"] });
    const client = world.connect();
    client.send(newSessionOn(1, { provider: "conn-b" }));
    vi.advanceTimersByTime(IDLE_CHECK_MS);
    const b = world.harness("claude-code/conn-b");
    expect(b.killed()).toBe(false);
    b.replyTo("session/new", { sessionId: "s-b" });
    expect(client.reply(1)?.result).toMatchObject({ sessionId: "s-b" });
  });

  /** TEST_SCENARIO: Background work in a session keeps that session's
   * process alive after its client leaves, on a process keyed by its model. */
  it("keeps a lease busy while one of its sessions holds background work", () => {
    vi.useFakeTimers();
    const world = createLeaseWorld({ providers: ["conn-a", "conn-b"] });
    const client = world.connect();
    startSession(world, client, "claude-code/conn-b/opus", "s-b", 1, {
      provider: "conn-b",
      model: "opus",
    });
    world.backgroundWork.report("s-b", [{ id: "build" }]);
    client.disconnect();
    vi.advanceTimersByTime(IDLE_REAP_DELAY_MS + IDLE_CHECK_MS);
    expect(world.harness("claude-code/conn-b/opus").killed()).toBe(false);
  });

  /** TEST_SCENARIO: A kept Detached Process runs outside every harness, so
   * the agent stays awake for it even before any lease is open, and the
   * status says how many there are, so the UI can explain why. */
  it("stays busy for kept Detached Processes with no lease open", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    world.keepProcesses(2);
    expect(world.router.leases()).toEqual([]);
    expect(world.router.status()).toEqual({
      idle: false,
      backgroundWork: [],
      keptProcesses: 2,
    });

    world.keepProcesses(0);
    expect(world.router.status()).toEqual({
      idle: true,
      backgroundWork: [],
      keptProcesses: 0,
    });
  });

  /** TEST_SCENARIO: A restart of the harness leaves a Detached Process
   * running, so a kept one does not hold an env change back. */
  it("recycles for an env change while a kept Detached Process runs", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const client = world.connect();
    startSession(world, client, "claude-code/conn-a", "s", 1, {});
    world.keepProcesses(1);
    world.router.refreshEnv({ force: false });
    expect(world.harness("claude-code/conn-a").killed()).toBe(true);
  });

  /** TEST_SCENARIO: Changing a session's model moves it to the process for
   * that model. The session keeps its harness and provider, the new process
   * loads the session before its first prompt there, and the process it left
   * releases it, shutting down when it holds nothing else, so a harness that
   * locks a session to one writer can load it in the new one. */
  it("moves a session to the process for the model it is pinned to", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const client = world.connect();
    startSession(world, client, "claude-code/conn-a/sonnet", "s", 1, {
      model: "sonnet",
    });
    client.send({
      jsonrpc: "2.0",
      id: 2,
      method: PIN_MODEL_METHOD,
      params: { sessionId: "s", model: "opus" },
    });
    expect(client.reply(2)?.result).toEqual({ model: "opus" });
    expect(world.harness("claude-code/conn-a/sonnet").killed()).toBe(true);
    expect(world.metadata.store.get("s")?.meta).toMatchObject({
      harness: "claude-code",
      provider: "conn-a",
      model: "opus",
    });
    client.send(frames.prompt(3, "s", "on opus"));
    const opus = world.harness("claude-code/conn-a/opus");
    const loads = opus
      .receivedMethods()
      .filter((m) => ["session/load", "session/resume"].includes(m));
    expect(loads).toHaveLength(1);
    opus.replyTo(loads[0]!, {});
    expect(promptTextsOf(opus)).toEqual(["on opus"]);
    expect(promptTextsOf(world.harness("claude-code/conn-a/sonnet"))).toEqual(
      [],
    );
  });

  /** TEST_SCENARIO: Another tab can pick a new model while the session's
   * turn runs. The move would leave the running turn on a process about to
   * shut down, so the change is refused until the turn ends. */
  it("refuses a model change while the session's turn runs", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const client = world.connect();
    startSession(world, client, "claude-code/conn-a/sonnet", "s", 1, {
      model: "sonnet",
    });
    const pin = (id: number) =>
      client.send({
        jsonrpc: "2.0",
        id,
        method: PIN_MODEL_METHOD,
        params: { sessionId: "s", model: "opus" },
      });
    client.send(frames.prompt(2, "s", "busy"));
    pin(3);
    expect(client.reply(3)?.error).toMatchObject({ code: -32000 });
    expect(world.harness("claude-code/conn-a/sonnet").killed()).toBe(false);
    world
      .harness("claude-code/conn-a/sonnet")
      .replyToSession("session/prompt", "s", { stopReason: "end_turn" });
    pin(4);
    expect(client.reply(4)?.result).toEqual({ model: "opus" });
  });

  /** TEST_SCENARIO: A mode picked during a turn belongs to the session's next
   * turn: it reaches the harness only once the running turn ends, and the
   * prompt sent after it waits for the harness to take the mode first. Another
   * session on the same process is untouched and the process is not
   * restarted. */
  it("applies a session setting to that session's next turn only", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const client = world.connect();
    startSession(world, client, "claude-code/conn-a", "s", 1, {});
    startSession(world, client, "claude-code/conn-a", "other", 2, {});
    const harness = world.harness("claude-code/conn-a");
    client.send(frames.prompt(3, "s", "first"));
    client.send({
      jsonrpc: "2.0",
      id: 4,
      method: CONFIGURE_SESSION_METHOD,
      params: { sessionId: "s", settings: { mode: "plan" } },
    });
    expect(client.reply(4)?.result).toEqual({ settings: { mode: "plan" } });
    client.send(frames.prompt(5, "s", "second"));
    expect(harness.received("session/set_mode")).toEqual([]);

    harness.replyToSession("session/prompt", "s", { stopReason: "end_turn" });
    expect(harness.received("session/set_mode")).toEqual([
      expect.objectContaining({ params: { sessionId: "s", modeId: "plan" } }),
    ]);
    expect(promptTextsOf(harness)).toEqual(["first"]);
    harness.replyTo("session/set_mode", {});
    expect(promptTextsOf(harness)).toEqual(["first", "second"]);
    expect(world.harnessCount("claude-code/conn-a")).toBe(1);
    expect(world.metadata.store.get("other")?.meta.settings).toBeUndefined();
  });

  /** TEST_SCENARIO: A mode picked while the session is idle reaches the
   * harness before the session's next prompt. */
  it("applies a setting picked between turns before the next prompt", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const client = world.connect();
    startSession(world, client, "claude-code/conn-a", "s", 1, {});
    const harness = world.harness("claude-code/conn-a");
    client.send({
      jsonrpc: "2.0",
      id: 2,
      method: CONFIGURE_SESSION_METHOD,
      params: { sessionId: "s", settings: { mode: "plan" } },
    });
    expect(client.reply(2)?.result).toEqual({ settings: { mode: "plan" } });
    expect(harness.received("session/set_mode")).toEqual([
      expect.objectContaining({ params: { sessionId: "s", modeId: "plan" } }),
    ]);
    client.send(frames.prompt(3, "s", "next"));
    expect(promptTextsOf(harness)).toEqual([]);
    harness.replyTo("session/set_mode", {});
    expect(promptTextsOf(harness)).toEqual(["next"]);
  });

  /** TEST_SCENARIO: Every session setting holds a real value, so the harness
   * is never left to guess what an unset one means. A change that names no
   * value is refused, and the saved value stays. */
  it("refuses to clear a session setting", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const client = world.connect();
    startSession(world, client, "claude-code/conn-a", "s", 1, {});
    const configure = (id: number, mode: string | null) =>
      client.send({
        jsonrpc: "2.0",
        id,
        method: CONFIGURE_SESSION_METHOD,
        params: { sessionId: "s", settings: { mode } },
      });
    configure(2, "plan");
    configure(3, null);
    expect(client.reply(3)?.error).toMatchObject({ code: -32602 });
    expect(world.metadata.store.get("s")?.meta.settings).toEqual({
      mode: "plan",
    });
  });

  /** TEST_SCENARIO: A harness can switch a session's mode on its own, as
   * Claude Code and Bob do when plan mode hands over to implementation. The
   * session's saved mode follows the harness, also when the session never
   * picked one, so the picker shows the mode the session runs on, a load into
   * another process restores it, and picking plan again reaches the harness. */
  it("follows a mode the harness switched to on its own", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const client = world.connect();
    startSession(world, client, "claude-code/conn-a", "s", 1, {});
    const harness = world.harness("claude-code/conn-a");
    const report = (mode: string) =>
      harness.emit({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "s",
          update: { sessionUpdate: "current_mode_update", currentModeId: mode },
        },
      });
    report("acceptEdits");
    expect(world.metadata.store.get("s")?.meta.settings).toEqual({
      mode: "acceptEdits",
    });
    client.send({
      jsonrpc: "2.0",
      id: 2,
      method: CONFIGURE_SESSION_METHOD,
      params: { sessionId: "s", settings: { mode: "plan" } },
    });
    harness.replyTo("session/set_mode", {});
    report("auto");
    expect(world.metadata.store.get("s")?.meta.settings).toEqual({
      mode: "auto",
    });
    client.send({
      jsonrpc: "2.0",
      id: 3,
      method: CONFIGURE_SESSION_METHOD,
      params: { sessionId: "s", settings: { mode: "plan" } },
    });
    expect(harness.received("session/set_mode")).toHaveLength(2);
  });

  /** TEST_SCENARIO: After the agent restarts, a client that loads a saved
   * session gets its saved mode on the new harness process before it can
   * prompt, so the setting survives the restart. */
  it("re-applies a saved setting when a client loads the session", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    world.metadata.store.set("saved", {
      mode: "chat",
      harness: "claude-code",
      provider: "conn-a",
      settings: { mode: "plan" },
    });
    const client = world.connect();
    client.send(frames.loadSession(1, "saved"));
    const harness = world.harness("claude-code/conn-a");
    harness.replyToSession("session/load", "saved", {});
    expect(harness.received("session/set_mode")).toEqual([
      expect.objectContaining({
        params: { sessionId: "saved", modeId: "plan" },
      }),
    ]);
  });

  /** TEST_SCENARIO: A setting the harness reads only at start moves the
   * session to a process started with it, so the process other sessions run
   * on is neither restarted nor changed. A session in the middle of a turn
   * cannot move, so the change is refused until the turn ends. */
  it("runs a session with a start-time setting in a process of its own", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const client = world.connect();
    startSession(world, client, "claude-code/conn-a", "s", 1, {});
    startSession(world, client, "claude-code/conn-a", "other", 2, {});
    const shared = world.harness("claude-code/conn-a");
    client.send(frames.prompt(3, "s", "busy"));
    const configure = (id: number) =>
      client.send({
        jsonrpc: "2.0",
        id,
        method: CONFIGURE_SESSION_METHOD,
        params: { sessionId: "s", settings: { cacheTtl: "1h" } },
      });
    configure(4);
    expect(client.reply(4)?.error).toMatchObject({ code: -32000 });

    shared.replyToSession("session/prompt", "s", { stopReason: "end_turn" });
    configure(5);
    expect(client.reply(5)?.result).toEqual({ settings: { cacheTtl: "1h" } });
    client.send(frames.prompt(6, "s", "cached"));
    const own = world.harness("claude-code/conn-a/cache-1h");
    const load = own
      .receivedMethods()
      .find((m) => ["session/load", "session/resume"].includes(m));
    own.replyTo(load!, {});
    expect(promptTextsOf(own)).toEqual(["cached"]);
    expect(shared.killed()).toBe(false);
    client.send(frames.prompt(7, "other", "unchanged"));
    expect(promptTextsOf(shared)).toEqual(["busy", "unchanged"]);
  });

  /** TEST_SCENARIO: A setting the session's harness does not offer is refused
   * when the session is created and when it is changed, so a session never
   * runs on a value the harness would ignore. */
  it("refuses a setting the harness cannot apply to one session", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const client = world.connect();
    client.send(newSessionOn(1, {}));
    client.send({
      jsonrpc: "2.0",
      id: 2,
      method: "session/new",
      params: {
        cwd: ".",
        _meta: { platform: { settings: { approvals: "ask" } } },
      },
    });
    expect(client.reply(2)?.error).toMatchObject({ code: -32602 });
    world
      .harness("claude-code/conn-a")
      .replyTo("session/new", { sessionId: "s" });
    client.send({
      jsonrpc: "2.0",
      id: 3,
      method: CONFIGURE_SESSION_METHOD,
      params: { sessionId: "s", settings: { approvals: "ask" } },
    });
    expect(client.reply(3)?.error).toMatchObject({ code: -32602 });
  });
});
