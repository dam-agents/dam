import { describe, it, expect, afterEach, vi } from "vitest";
import { createWorld, frames, type Client, type World } from "./acp-world.js";

/**
 * TEST_OVERVIEW: form elicitation — the agent asks the user a question with a
 * form (Claude Code's AskUserQuestion arrives as `elicitation/create`).
 *
 * One harness serves every client, and it reads client capabilities once, so
 * the runtime always tells it forms are supported. Who may answer is decided
 * per request: only a client that said in its own `initialize` that it can
 * render a form sees the question. A turn started by any other client (a
 * Slack turn, the CLI, a schedule) gets a `decline` at once, so it never
 * waits on an answer that cannot come. A question for a person who can
 * answer waits like a permission prompt: it follows them to a new tab, the
 * first answer wins, and it expires when nobody who could answer is left.
 */

const ORPHAN_TTL_MS = 60_000;
const SESSION = "sess-elicit";

const askingFrame = (id: number, sessionId = SESSION) => ({
  jsonrpc: "2.0",
  id,
  method: "elicitation/create",
  params: {
    mode: "form",
    sessionId,
    toolCallId: `tool-${id}`,
    message: "Which database?",
    requestedSchema: {
      type: "object",
      properties: {
        question_0: {
          type: "string",
          oneOf: [
            { const: "Postgres", title: "Postgres", description: "SQL" },
            { const: "Redis", title: "Redis" },
          ],
        },
        question_0_custom: { type: "string", title: "Other" },
      },
    },
  },
});

const acceptFrame = (id: number, choice: string) => ({
  jsonrpc: "2.0",
  id,
  result: { action: "accept", content: { question_0: choice } },
});

function connectAsker(world: World): Client {
  const client = world.connect();
  client.send({
    jsonrpc: "2.0",
    id: 100,
    method: "initialize",
    params: {
      protocolVersion: 1,
      clientCapabilities: { elicitation: { form: {} } },
    },
  });
  return client;
}

function connectMachine(world: World): Client {
  const client = world.connect({ viewer: false });
  client.send(frames.initialize(100));
  return client;
}

function startTurn(world: World, client: Client): void {
  client.send(frames.newSession(1));
  world.harness().replyTo("session/new", { sessionId: SESSION });
  client.send(frames.prompt(2, SESSION, "set up the cache"));
}

describe("acp-runtime: form elicitation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * TEST_SCENARIO: The first client to connect is a machine client that
   * advertises nothing. The harness must still learn that forms are
   * supported, or AskUserQuestion stays switched off for every later web
   * user of this harness.
   */
  it("should tell the harness forms are supported whoever initializes first", () => {
    const world = createWorld();
    connectMachine(world);

    const [init] = world.harness().received("initialize");
    expect(init?.params).toMatchObject({
      clientCapabilities: { elicitation: { form: {} } },
    });
  });

  /**
   * TEST_SCENARIO: A web user starts a turn, and the agent asks them a
   * question. The user must see the form, and their answer must reach the
   * agent unchanged.
   */
  it("should put the question to a user who can answer it", () => {
    const world = createWorld();
    const alice = connectAsker(world);
    world.harness().replyTo("initialize", { protocolVersion: 1 });
    startTurn(world, alice);

    world.harness().emit(askingFrame(70));
    expect(alice.saw("elicitation/create")).toHaveLength(1);

    alice.send(acceptFrame(70, "Redis"));
    expect(world.harness().answersTo(70)).toEqual([
      expect.objectContaining({
        result: { action: "accept", content: { question_0: "Redis" } },
      }),
    ]);
  });

  /**
   * TEST_SCENARIO: A Slack turn — its client cannot render a form — and the
   * agent asks a question. The harness must get a decline straight away, so
   * the turn carries on, and the Slack client must never see the question.
   * This holds even when a web user is watching the same session, because
   * the person the turn answers is in Slack.
   */
  it("should decline at once on a turn nobody can answer", () => {
    const world = createWorld();
    const slack = connectMachine(world);
    world.harness().replyTo("initialize", { protocolVersion: 1 });
    startTurn(world, slack);
    const watcher = connectAsker(world);
    watcher.send(frames.loadSession(3, SESSION));

    world.harness().emit(askingFrame(71));

    expect(world.harness().answersTo(71)).toEqual([
      expect.objectContaining({ result: { action: "decline" } }),
    ]);
    expect(slack.saw("elicitation/create")).toEqual([]);
    expect(watcher.saw("elicitation/create")).toEqual([]);
    expect(world.runtime.status().idle).toBe(false);
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    expect(world.runtime.status().idle).toBe(true);
  });

  /**
   * TEST_SCENARIO: The agent asks while a web user and a machine client are
   * both on the session. Only the web user is asked. The user reloads: the
   * new tab must show the question again, and its answer must win. A late
   * answer from the old tab must not reach the agent a second time.
   */
  it("should follow the user to a reloaded tab and take only the first answer", () => {
    const world = createWorld();
    const alice = connectAsker(world);
    world.harness().replyTo("initialize", { protocolVersion: 1 });
    startTurn(world, alice);
    const machine = connectMachine(world);
    machine.send(frames.loadSession(3, SESSION));

    world.harness().emit(askingFrame(72));
    expect(machine.saw("elicitation/create")).toEqual([]);

    alice.disconnect();
    const reloaded = connectAsker(world);
    reloaded.send(frames.loadSession(4, SESSION));
    expect(reloaded.saw("elicitation/create")).toHaveLength(1);

    reloaded.send(acceptFrame(72, "Postgres"));
    alice.send(acceptFrame(72, "Redis"));
    expect(world.harness().answersTo(72)).toEqual([
      expect.objectContaining({
        result: { action: "accept", content: { question_0: "Postgres" } },
      }),
    ]);
  });

  /**
   * TEST_SCENARIO: The user asked, then closed the tab before the agent's
   * question came. A machine client is still on the session, but it cannot
   * answer. The question must wait the orphan window for the user, then
   * expire with an error, so the tool call ends instead of hanging.
   */
  it("should expire the question when only clients that cannot answer remain", () => {
    vi.useFakeTimers();
    const world = createWorld({ orphanTtlMs: ORPHAN_TTL_MS });
    const alice = connectAsker(world);
    world.harness().replyTo("initialize", { protocolVersion: 1 });
    startTurn(world, alice);
    const machine = connectMachine(world);
    machine.send(frames.loadSession(3, SESSION));
    alice.disconnect();

    world.harness().emit(askingFrame(73));
    expect(world.harness().answersTo(73)).toEqual([]);

    vi.advanceTimersByTime(ORPHAN_TTL_MS);
    expect(world.harness().answersTo(73)).toEqual([
      expect.objectContaining({ error: expect.objectContaining({ code: -32000 }) }),
    ]);
  });

  /**
   * TEST_SCENARIO: The harness asks with no turn running — work it resumed
   * on its own. With a web user on the session the question goes to them;
   * with nobody who can answer it is declined.
   */
  it("should ask whoever can answer when no prompt started the turn", () => {
    const world = createWorld();
    const alice = connectAsker(world);
    world.harness().replyTo("initialize", { protocolVersion: 1 });
    alice.send(frames.newSession(1));
    world.harness().replyTo("session/new", { sessionId: SESSION });

    world.harness().emit(askingFrame(74));
    expect(alice.saw("elicitation/create")).toHaveLength(1);

    world.harness().emit(askingFrame(75, "sess-nobody"));
    expect(world.harness().answersTo(75)).toEqual([
      expect.objectContaining({ result: { action: "decline" } }),
    ]);
  });
});
