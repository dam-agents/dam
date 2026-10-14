import { describe, it, expect, afterEach, vi } from "vitest";
import {
  createSessionMetadata,
  createWorld,
  frames,
  QUEUE_PARK_MS,
} from "./acp-world.js";
import type { DocumentStoreBackend } from "../../../../../core/document-store.js";
import { createUndeliveredPromptStore } from "../../../infrastructure/undelivered-prompt-store.js";

/**
 * TEST_OVERVIEW: applying an env change to a running sandbox.
 *
 * The harness reads env once, at spawn. A credential granted or rotated
 * later reaches the agent only when the harness process is recycled. The
 * runtime must do that swap without cutting off anyone's work: right away
 * when the sandbox is idle, after the running turn ends when it is not,
 * and — when the caller forces it — after a bounded grace period even if
 * work never drains, so a revoked credential cannot stay usable forever.
 * The idle and mid-turn swaps are pinned in
 * `acp-runtime-mass-disconnect.test.ts`.
 */

const SESSION = "sess-env";

let tick = 0;
const clock = (): string => `t${String(++tick).padStart(6, "0")}`;

function createMemoryBackend(): DocumentStoreBackend {
  return {
    open(_name, opts) {
      let state = opts.initial();
      return {
        read: () => state,
        write(next) {
          state = next;
        },
      };
    },
  };
}

describe("acp-runtime: env changes", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * TEST_SCENARIO: An env change forces a recycle while messages are still
   * queued behind the running turn. Those prompts exist nowhere but this
   * process — the harness has never seen them — so killing it would lose
   * work the user was told was waiting, and no client is left holding a copy
   * to report it either.
   *
   * A queue may not be discarded anywhere without being written down first,
   * so every route that drops one — the park window expiring, a session
   * being released, the harness going down — hands its prompts to the same
   * recorder. This is the route only the runtime can see: a browser cannot
   * make a harness exit, and the client that sent the prompts may be long
   * gone by the time it happens.
   */
  it("should record queued prompts as undelivered when the harness goes down", () => {
    const undelivered = createUndeliveredPromptStore(
      createMemoryBackend(),
      clock,
    );
    vi.useFakeTimers();
    const metadata = createSessionMetadata();
    const world = createWorld({
      undeliveredPrompts: undelivered,
      sessionMetadata: metadata.store,
      envForceRecycleMs: 60_000,
    });

    const client = world.connect();
    client.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    client.send(frames.prompt(2, SESSION, "run the migration"));
    client.send(frames.prompt(3, SESSION, "then check the logs"));

    world.runtime.refreshEnv({ force: true });
    vi.advanceTimersByTime(60_000);

    expect(
      undelivered
        .readFor(SESSION)
        .flatMap((p) => p.blocks.map((b) => (b.type === "text" ? b.text : ""))),
    ).toEqual(["then check the logs"]);
  });

  /**
   * TEST_SCENARIO: An env change lands while a session setting (a mode
   * switch) waits for the harness's answer, with no turn running. The
   * setting keeps the runtime busy for that moment only; its answer is the
   * idle edge, and the env change must apply there rather than wait for the
   * grace period — or, for a value-only change that is never forced, wait
   * until some later turn happens to end.
   */
  it("should recycle when the last setting answer leaves the runtime idle", () => {
    const world = createWorld();
    const client = world.connect();
    client.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    client.send({
      jsonrpc: "2.0",
      id: 2,
      method: "session/set_mode",
      params: { sessionId: SESSION, modeId: "plan" },
    });

    world.runtime.refreshEnv({ force: false });
    expect(world.harness().killed()).toBe(false);

    world.harness().replyTo("session/set_mode", {});

    expect(world.harness().killed()).toBe(true);
  });

  /**
   * TEST_SCENARIO: An env change lands while the harness waits on a client
   * for a request that names no session. The client's answer is the idle
   * edge: no turn ends after it to apply the change.
   */
  it("should recycle when a client answers the last open agent request", () => {
    const world = createWorld();
    const client = world.connect();
    client.send(frames.initialize(1));
    world.harness().replyTo("initialize", { agentCapabilities: {} });
    world
      .harness()
      .emit({ jsonrpc: "2.0", id: 900, method: "x/ask", params: {} });

    world.runtime.refreshEnv({ force: false });
    expect(world.harness().killed()).toBe(false);

    client.send({ jsonrpc: "2.0", id: 900, result: {} });

    expect(world.harness().killed()).toBe(true);
  });

  /**
   * TEST_SCENARIO: An env change lands on an idle runtime while a client call
   * that is not a prompt, such as ACP initialize or an e2e control call,
   * waits for the harness's answer. The recycle would fail that call, so it
   * waits for the answer, and recycles at once when it comes.
   */
  it("should recycle when the harness answers the last call in flight", () => {
    const world = createWorld();
    const client = world.connect();
    client.send(frames.initialize(1));

    world.runtime.refreshEnv({ force: false });
    expect(world.harness().killed()).toBe(false);

    world.harness().replyTo("initialize", { agentCapabilities: {} });

    expect(client.reply(1)).toMatchObject({
      result: { agentCapabilities: {} },
    });
    expect(world.harness().killed()).toBe(true);
  });

  /**
   * TEST_SCENARIO: A call in flight that the harness never answers holds an
   * env change back for a bounded time only, ten seconds, so a value-only
   * change that is never forced still lands, and the call is then answered
   * with the recycle's reason.
   */
  it("should recycle after the bound when a call in flight is never answered", () => {
    vi.useFakeTimers();
    const world = createWorld();
    const client = world.connect();
    client.send(frames.initialize(1));

    world.runtime.refreshEnv({ force: false });
    vi.advanceTimersByTime(9_999);
    expect(world.harness().killed()).toBe(false);

    vi.advanceTimersByTime(1);

    expect(world.harness().killed()).toBe(true);
    expect(client.reply(1)).toMatchObject({
      error: { message: "agent recycled for env change" },
    });
  });

  /**
   * TEST_SCENARIO: An env change lands while a prompt waits parked behind a
   * finished turn, its sender gone, on a harness that cannot close sessions.
   * The parked queue keeps the runtime busy until the park window drops it;
   * no session is closed then, so the drop itself is the idle edge.
   */
  it("should recycle when a parked queue expires on a harness without session close", () => {
    vi.useFakeTimers();
    const world = createWorld();
    const client = world.connect();
    client.send(frames.initialize(1));
    world.harness().replyTo("initialize", { agentCapabilities: {} });
    client.send(frames.newSession(2));
    world.harness().replyTo("session/new", { sessionId: SESSION });
    client.send(frames.prompt(3, SESSION, "first"));
    client.send(frames.prompt(4, SESSION, "second"));
    client.disconnect();
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    world.runtime.refreshEnv({ force: false });
    expect(world.harness().killed()).toBe(false);

    vi.advanceTimersByTime(QUEUE_PARK_MS);

    expect(world.harness().killed()).toBe(true);
  });

  /**
   * TEST_SCENARIO: An env change lands mid-turn and the turn never ends — a
   * stuck tool call, an endless loop. Without a bound, a revoked credential
   * would stay live for as long as the turn runs. A forced refresh waits a
   * grace period for the work to drain, then recycles anyway and tells the
   * connected clients why.
   */
  it("should force the recycle after the grace period when work never drains", () => {
    vi.useFakeTimers();

    const world = createWorld({ envForceRecycleMs: 60_000 });
    const client = world.connect();
    client.send(frames.initialize(1));
    client.send(frames.newSession(2));
    world.harness().replyTo("session/new", { sessionId: "s1" });
    client.send(frames.prompt(3, "s1", "run forever"));

    world.runtime.refreshEnv({ force: true });

    expect(world.harness().killed()).toBe(false);

    vi.advanceTimersByTime(60_000);

    expect(world.harness().killed()).toBe(true);
    expect(client.closes[0]).toMatchObject({
      code: 1011,
      reason: "agent recycled for env change",
    });
  });
});
