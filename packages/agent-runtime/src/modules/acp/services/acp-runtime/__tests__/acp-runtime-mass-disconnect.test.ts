import { describe, it, expect } from "vitest";
import { createWorld, frames, transcriptOf } from "./acp-world.js";

/**
 * Feature: everyone is disconnected at once.
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

/** Let the runtime's `exited` promise handler run. */
const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

const SESSION = "sess-live";

describe("acp-runtime: everyone is disconnected at once", () => {
  /**
   * The harness is a subprocess and it can die at any moment, silently:
   * clients hear nothing, and a socket left open after it is a lie — it
   * looks connected while every frame sent down it goes nowhere. The runtime
   * is the only party that observes the exit, so only it can turn a silent
   * death into an explicit close on every connection. Every one: a client
   * that never opened a session is talking to the same dead sandbox, and
   * left open its next list poll would just hang. The code says reconnect,
   * because a dead harness is a fault the platform repairs, not a goodbye.
   */
  it("should close every client with a reconnect code when the harness dies, even one that never opened a session", async () => {
    const world = createWorld();

    // Alice is in a conversation; the sidebar polls the session list on its
    // own connection and never opens anything.
    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    const sidebar = world.connect();
    sidebar.send(frames.listSessions(1));
    world.harness().replyTo("session/list", { sessions: [] });

    // The harness dies on its own, telling nobody.
    world.harness().exit();
    await flushMicrotasks();

    // Both find out the same way, once, with the code that means "come
    // back": the one in the conversation and the one that never named a
    // session at all.
    expect(alice.closes).toEqual([{ code: 1011, reason: "agent exited" }]);
    expect(sidebar.closes).toEqual([{ code: 1011, reason: "agent exited" }]);
  });

  /**
   * The harness reads its env once, at spawn. When the config changes on
   * disk, the running harness is permanently blind to it — the only way to
   * apply the change is a fresh harness, and every connection goes with the
   * old one, because each client's picture of the sandbox was built against
   * the process being retired. With nothing running there is nothing worth
   * waiting for, so the swap happens now. Clients get the same reconnect
   * code as a real death — from their side it is the same event with the
   * same remedy — and the sandbox is recycled rather than closed: the next
   * client to arrive gets a new harness, which is the whole point, since
   * that one reads the new env.
   */
  it("should recycle the harness for a config change when nothing is running, and give the next client a fresh one", () => {
    const world = createWorld();

    // Alice's conversation is finished, the sidebar is idle. Nothing runs.
    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "rename the module"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    const sidebar = world.connect();
    sidebar.send(frames.listSessions(1));
    world.harness().replyTo("session/list", { sessions: [] });

    // The config changes under the sandbox.
    const oldHarness = world.harness();
    world.runtime.refreshEnv({ force: false });

    // Everyone is out with the code that means "come back", and the old
    // harness — blind to the new config forever — is gone.
    expect(alice.closes).toEqual([
      { code: 1011, reason: "agent recycled for env change" },
    ]);
    expect(sidebar.closes).toEqual([
      { code: 1011, reason: "agent recycled for env change" },
    ]);
    expect(oldHarness.killed()).toBe(true);

    // Coming back works: the next client is served by a brand-new harness,
    // not turned away as it would be after a real death.
    const next = world.connect();
    next.send(frames.initialize(1));

    expect(next.isOpen()).toBe(true);
    expect(world.harnessCount()).toBe(2);
    expect(world.harness()).not.toBe(oldHarness);
    expect(world.harness().receivedMethods()).toEqual(["initialize"]);
  });

  /**
   * The same config change lands while the agent is mid-answer. Recycling
   * now would kill a turn someone asked for and is watching, to apply a
   * change nobody needs this second. The runtime is the only party that
   * knows both facts at once — that a recycle is owed and that a turn is in
   * flight — so it sits on the change, lets the turn stream to its end as
   * if nothing had happened, delivers the answer, and only then takes the
   * connections.
   */
  it("should hold a mid-turn config change until the turn ends, then disconnect everyone", () => {
    const world = createWorld();

    // Alice asks, Bob is watching, and the agent is mid-answer.
    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    alice.send(frames.prompt(2, SESSION, "migrate the database"));
    const bob = world.connect();
    bob.send(frames.loadSession(1, SESSION));
    world.harness().emit(frames.agentMessage(SESSION, "halfway there"));

    // The config changes with the turn still running.
    world.runtime.refreshEnv({ force: false });

    // Nobody is touched: the sockets stay up, the harness stays up, and the
    // turn keeps streaming to its audience as if nothing were pending.
    expect(alice.isOpen()).toBe(true);
    expect(bob.isOpen()).toBe(true);
    expect(world.harness().killed()).toBe(false);
    world.harness().emit(frames.agentMessage(SESSION, "switching over"));

    // The turn ends on its own terms.
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    // The answer reached its asker before the door shut, and Bob heard the
    // whole turn. Only then was everyone let go, with the reconnect code.
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

  /**
   * Shutdown is the one ending that is on purpose: the platform is taking
   * the pod down. A client that treated this close like a harness death
   * would reconnect into nothing, and a reconnect loop on every open tab is
   * exactly the storm a rolling restart does not need. The close code is
   * the only channel the runtime has to say so, and 1000 — a normal
   * closure — is the one that means finished, not failed.
   */
  it("should close every client with a do-not-reconnect code on shutdown", () => {
    const world = createWorld();

    // Alice is in a conversation, the sidebar is just connected.
    const alice = world.connect();
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    const sidebar = world.connect();
    sidebar.send(frames.listSessions(1));
    world.harness().replyTo("session/list", { sessions: [] });

    world.runtime.shutdown();

    // Everyone is told this is final — the code that means do not come
    // back — and the harness goes down with the pod.
    expect(alice.closes).toEqual([{ code: 1000, reason: "shutdown" }]);
    expect(sidebar.closes).toEqual([{ code: 1000, reason: "shutdown" }]);
    expect(world.harness().killed()).toBe(true);
  });
});
