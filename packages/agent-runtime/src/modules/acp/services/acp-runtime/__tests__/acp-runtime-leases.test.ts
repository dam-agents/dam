import { describe, it, expect, afterEach, vi } from "vitest";
import { PIN_MODEL_METHOD } from "agent-runtime-api";
import {
  IDLE_REAP_DELAY_MS,
  createClient,
  createHarness,
  createInMemoryUndeliveredStore,
  createSessionMetadata,
  frames,
  memoryDocumentBackend,
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

function createLeaseWorld(opts: { providers: string[] }) {
  let providers = opts.providers;
  const metadata = createSessionMetadata();
  const harnesses = new Map<string, Harness[]>();
  const key = (pair: LeasePair): string =>
    `${pair.harness}/${pair.provider ?? "-"}${pair.model ? `/${pair.model}` : ""}`;
  const backgroundWork = createBackgroundWorkRegistry();
  const router = createLeaseRouter({
    defaultHarness: "claude-code",
    harnessKnown: (h) => ["claude-code", "codex"].includes(h),
    providers: () => providers,
    sessionMetadata: metadata.store,
    backgroundWork,
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
        spawnAgent: () => {
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

  /** TEST_SCENARIO: Taking provider B away recycles B's process and leaves
   * A's running; a prompt to B's session then fails naming the provider,
   * instead of running on another one. */
  it("recycles only the removed provider's process and refuses its sessions", () => {
    const world = createLeaseWorld({ providers: ["conn-a", "conn-b"] });
    const client = world.connect();
    startSession(world, client, "claude-code/conn-a", "s-a", 1, {});
    startSession(world, client, "claude-code/conn-b", "s-b", 2, {
      provider: "conn-b",
    });

    world.revoke("conn-b");
    expect(world.harness("claude-code/conn-b").killed()).toBe(true);
    expect(world.harness("claude-code/conn-a").killed()).toBe(false);

    const fresh = world.connect();
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

  /** TEST_SCENARIO: Changing a session's model moves it to the process for
   * that model. The session keeps its harness and provider, its next prompt
   * reaches the new process, and the process it left gets nothing more. */
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
    expect(world.metadata.store.get("s")?.meta).toMatchObject({
      harness: "claude-code",
      provider: "conn-a",
      model: "opus",
    });
    client.send(frames.prompt(3, "s", "on opus"));
    expect(promptTextsOf(world.harness("claude-code/conn-a/opus"))).toEqual([
      "on opus",
    ]);
    expect(promptTextsOf(world.harness("claude-code/conn-a/sonnet"))).toEqual(
      [],
    );
  });

  /** TEST_SCENARIO: A process whose provider was taken away holds no
   * credential the agent may still use, so it is shut down rather than
   * restarted without one. */
  it("shuts down the process of a removed provider", () => {
    const world = createLeaseWorld({ providers: ["conn-a", "conn-b"] });
    const client = world.connect();
    startSession(world, client, "claude-code/conn-b", "s-b", 1, {
      provider: "conn-b",
    });
    world.revoke("conn-b");
    expect(world.harness("claude-code/conn-b").killed()).toBe(true);
    expect(world.harnessCount("claude-code/conn-b")).toBe(1);
    expect(world.router.leases().map((l) => l.provider)).toEqual(["conn-a"]);
  });
});
