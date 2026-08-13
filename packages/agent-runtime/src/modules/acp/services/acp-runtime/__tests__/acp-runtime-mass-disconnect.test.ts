import { describe, it, expect } from "vitest";
import { createWorld, frames, transcriptOf } from "./acp-world.js";

/**
 * TEST_OVERVIEW: everyone is disconnected at once.
 *
 * The other features are about one client arriving or leaving. This one is
 * about the three moments the sandbox ends every connection itself: the
 * harness dies underneath it, the sandbox's config changes and the harness
 * must be restarted to read it, and the pod is told to shut down. From a
 * client's side of the socket these are indistinguishable — the connection
 * closes — so the close code has to carry the one decision the client must
 * now make alone: whether to come back. 1011 says the sandbox will be here
 * again, reconnect; 1000 says it is leaving on purpose, do not.
 *
 * See `acp-runtime-leaving.test.ts` for a single departure; this feature is
 * the whole room going dark at once.
 */

const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

const SESSION = "sess-live";

describe("acp-runtime: everyone is disconnected at once", () => {
  it("should close every client with a reconnect code when the harness dies, even one that never opened a session", async () => {
    const world = createWorld();

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    const sidebar = world.connect();
    sidebar.send(frames.listSessions(1));
    world.harness().replyTo("session/list", { sessions: [] });

    world.harness().exit();
    await flushMicrotasks();

    expect(alice.closes).toEqual([{ code: 1011, reason: "agent exited" }]);
    expect(sidebar.closes).toEqual([{ code: 1011, reason: "agent exited" }]);
  });

  it("should recycle the harness for a config change when nothing is running, and give the next client a fresh one", () => {
    const world = createWorld();

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "rename the module"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    const sidebar = world.connect();
    sidebar.send(frames.listSessions(1));
    world.harness().replyTo("session/list", { sessions: [] });

    const oldHarness = world.harness();
    world.runtime.refreshEnv({ force: false });

    expect(alice.closes).toEqual([
      { code: 1011, reason: "agent recycled for env change" },
    ]);
    expect(sidebar.closes).toEqual([
      { code: 1011, reason: "agent recycled for env change" },
    ]);
    expect(oldHarness.killed()).toBe(true);

    const next = world.connect();
    next.send(frames.initialize(1));

    expect(next.isOpen()).toBe(true);
    expect(world.harnessCount()).toBe(2);
    expect(world.harness()).not.toBe(oldHarness);
    expect(world.harness().receivedMethods()).toEqual(["initialize"]);
  });

  it("should hold a mid-turn config change until the turn ends, then disconnect everyone", () => {
    const world = createWorld();

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "migrate the database"));
    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));
    world.harness().emit(frames.agentMessage(SESSION, "halfway there"));

    world.runtime.refreshEnv({ force: false });

    expect(alice.isOpen()).toBe(true);
    expect(bob.isOpen()).toBe(true);
    expect(world.harness().killed()).toBe(false);
    world.harness().emit(frames.agentMessage(SESSION, "switching over"));

    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    expect(alice.reply(2)?.result).toEqual({ stopReason: "end_turn" });
    expect(transcriptOf(bob)).toEqual([
      `${SESSION}: migrate the database`,
      `${SESSION}: halfway there`,
      `${SESSION}: switching over`,
    ]);
    expect(alice.closes).toEqual([
      { code: 1011, reason: "agent recycled for env change" },
    ]);
    expect(bob.closes).toEqual([
      { code: 1011, reason: "agent recycled for env change" },
    ]);
    expect(world.harness().killed()).toBe(true);
  });

  it("should close every client with a do-not-reconnect code on shutdown", () => {
    const world = createWorld();

    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    const sidebar = world.connect();
    sidebar.send(frames.listSessions(1));
    world.harness().replyTo("session/list", { sessions: [] });

    world.runtime.shutdown();

    expect(alice.closes).toEqual([{ code: 1000, reason: "shutdown" }]);
    expect(sidebar.closes).toEqual([{ code: 1000, reason: "shutdown" }]);
    expect(world.harness().killed()).toBe(true);
  });
});
