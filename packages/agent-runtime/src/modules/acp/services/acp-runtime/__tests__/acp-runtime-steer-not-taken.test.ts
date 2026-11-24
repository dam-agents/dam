import { describe, expect, it } from "vitest";
import { createWorld, frames, type Client, type World } from "./acp-world.js";

/**
 * TEST_OVERVIEW: A channel's steer, and what the runtime logs when it does
 * not join the turn it names.
 *
 * A channel (Slack, Telegram) sends a message that arrives mid-turn as a
 * `_session/steering` request, which names the turn it may join. When the
 * steer does not join that turn, the channel runs the message as its next
 * turn. An unsupported answer is final: the channel stops steering for the
 * rest of its conversation, so the runtime gives it only when the harness
 * cannot steer, never while a harness its manifest says steers is still
 * starting. The log line says, afterwards, which answer a steer got and how
 * long it waited for a steer point first, so a message that queued can be
 * traced to its cause.
 */

const SESSION = "s-channel";
const STEER_METHOD = "_session/steering";
const TURN = "turn-1";

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

function update(update: Record<string, unknown>) {
  return {
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId: SESSION, update },
  };
}

function steer(id: number, promptId: string) {
  return {
    jsonrpc: "2.0",
    id,
    method: STEER_METHOD,
    params: {
      sessionId: SESSION,
      prompt: [{ type: "text", text: "one more thing" }],
      _meta: {
        steering: { idleBehavior: "promptRequired" },
        platform: { promptId, targetPromptId: TURN },
      },
    },
  };
}

async function channelTurnRunning(
  initialize: Record<string, unknown> | null,
  steering?: "native",
): Promise<{ world: World; logs: string[]; channel: Client }> {
  const logs: string[] = [];
  const world = createWorld({
    log: (msg) => logs.push(msg),
    ...(steering && { steering }),
  });
  const turn = world.connect({ viewer: false });
  turn.send(frames.initialize(1));
  if (initialize !== null) world.harness().replyTo("initialize", initialize);
  turn.send(frames.newSession(2));
  world.harness().replyTo("session/new", { sessionId: SESSION });
  await settle();
  turn.send({
    jsonrpc: "2.0",
    id: 3,
    method: "session/prompt",
    params: {
      sessionId: SESSION,
      prompt: [{ type: "text", text: "Run the tests." }],
      _meta: { platform: { promptId: TURN, surface: "slack" } },
    },
  });
  await settle();
  const channel = world.connect({ viewer: false });
  channel.send(frames.initialize(1));
  await settle();
  return { world, logs, channel };
}

const notTaken = (logs: string[]) =>
  logs.filter((line) => line.includes("not taken"));

describe("acp-runtime: a channel's steer that does not join its turn", () => {
  /**
   * TEST_SCENARIO: The steer waits for a steer point, and the turn ends
   * before one comes. The steer is answered noRunningTurn, and the log names
   * the steer, the session, that answer and the wait.
   */
  it("logs the answer and the wait when the turn ends first", async () => {
    const { world, logs, channel } = await channelTurnRunning({
      _meta: { steering: { supported: true } },
    });
    world.harness().emit(
      update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Running" } }),
    );
    channel.send(steer(2, "steer-a"));
    await settle();
    expect(world.harness().received(STEER_METHOD)).toEqual([]);
    expect(notTaken(logs)).toEqual([]);

    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    await settle();

    expect(channel.reply(2)).toMatchObject({
      result: { outcome: "promptRequired", reason: "noRunningTurn" },
    });
    expect(notTaken(logs)).toEqual([
      expect.stringMatching(
        /^steer steer-a for s-channel not taken: noRunningTurn after \d+ ms$/,
      ),
    ]);
  });

  /**
   * TEST_SCENARIO: The steer reaches the turn at a steer point and joins it.
   * Nothing is logged.
   */
  it("logs nothing for a steer that joins its turn", async () => {
    const { world, logs, channel } = await channelTurnRunning({
      _meta: { steering: { supported: true } },
    });
    world.harness().emit(
      update({ sessionUpdate: "tool_call", toolCallId: "t1", status: "pending" }),
    );
    channel.send(steer(2, "steer-b"));
    world.harness().emit(
      update({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" }),
    );
    await settle();
    world.harness().replyTo(STEER_METHOD, { outcome: "injected" });
    await settle();

    expect(channel.reply(2)).toMatchObject({ result: { outcome: "injected" } });
    expect(notTaken(logs)).toEqual([]);
  });

  /**
   * TEST_SCENARIO: The manifest says the harness steers, and the steer
   * arrives while the harness has not answered initialize yet — an agent that
   * just woke, or a harness that just restarted. The steer must wait rather
   * than be refused as unsupported, and join the turn at its first steer point
   * once the harness says it steers.
   */
  it("holds a steer for a harness that has not answered initialize yet", async () => {
    const { world, logs, channel } = await channelTurnRunning(null, "native");
    world.harness().emit(
      update({ sessionUpdate: "tool_call", toolCallId: "t1", status: "pending" }),
    );
    channel.send(steer(2, "steer-e"));
    await settle();
    expect(channel.reply(2)).toBeUndefined();

    world.harness().replyTo("initialize", {
      _meta: { steering: { supported: true } },
    });
    world.harness().emit(
      update({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" }),
    );
    await settle();
    expect(world.harness().received(STEER_METHOD)).toHaveLength(1);
    world.harness().replyTo(STEER_METHOD, { outcome: "injected" });
    await settle();

    expect(channel.reply(2)).toMatchObject({ result: { outcome: "injected" } });
    expect(notTaken(logs)).toEqual([]);
  });

  /**
   * TEST_SCENARIO: The manifest says the harness steers, but its initialize
   * answer does not. A steer after that answer is refused as unsupported.
   */
  it("refuses a steer once the harness answered that it does not steer", async () => {
    const { logs, channel } = await channelTurnRunning({}, "native");
    channel.send(steer(2, "steer-f"));
    await settle();

    expect(channel.reply(2)).toMatchObject({ error: { code: -32601 } });
    expect(notTaken(logs)).toEqual([
      "steer steer-f for s-channel not taken: the harness cannot steer (manifest native, initialize does not steer)",
    ]);
  });

  /**
   * TEST_SCENARIO: The harness's initialize answer does not say it steers.
   * The steer is refused at once as unsupported, which makes the channel stop
   * steering, and the log says what the manifest and the harness said.
   */
  it("logs why a harness that cannot steer refused the steer", async () => {
    const { logs, channel } = await channelTurnRunning({});
    channel.send(steer(2, "steer-c"));
    await settle();

    expect(channel.reply(2)).toMatchObject({ error: { code: -32601 } });
    expect(notTaken(logs)).toEqual([
      "steer steer-c for s-channel not taken: the harness cannot steer (manifest none, initialize does not steer)",
    ]);
  });

  /**
   * TEST_SCENARIO: The steer names a session with no prompt running or
   * queued. It is answered noRunningTurn at once, with no wait, and logged.
   */
  it("logs a steer for a session with nothing running", async () => {
    const { world, logs, channel } = await channelTurnRunning({
      _meta: { steering: { supported: true } },
    });
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    await settle();
    channel.send(steer(2, "steer-d"));
    await settle();

    expect(channel.reply(2)).toMatchObject({
      result: { outcome: "promptRequired", reason: "noRunningTurn" },
    });
    expect(notTaken(logs)).toEqual([
      "steer steer-d for s-channel not taken: noRunningTurn after 0 ms",
    ]);
  });
});
