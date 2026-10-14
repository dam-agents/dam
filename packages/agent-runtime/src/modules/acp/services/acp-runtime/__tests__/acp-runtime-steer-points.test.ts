import { describe, expect, it } from "vitest";
import { createWorld, frames, type Client, type World } from "./acp-world.js";

/**
 * TEST_OVERVIEW: When a prompt sent mid-turn is steered into the running turn.
 *
 * The harness takes a steer by aborting whatever the agent is generating, so a
 * steer that lands while the agent writes cuts its reply off and makes it start
 * over. The runtime therefore steers only at a steer point: right after the
 * agent's tool calls finish, before it writes again. A prompt sent while the
 * agent writes waits; if the turn ends first, it starts as the next turn.
 */

const SESSION = "s-steer";
const STEER_METHOD = "_session/steering";

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

function uiPrompt(id: number, text: string) {
  return {
    jsonrpc: "2.0",
    id,
    method: "session/prompt",
    params: {
      sessionId: SESSION,
      prompt: [{ type: "text", text }],
      _meta: { platform: { promptId: `p${id}`, surface: "ui" } },
    },
  };
}

function update(update: Record<string, unknown>) {
  return {
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId: SESSION, update },
  };
}

function promptTexts(frame: unknown): string[] {
  const prompt = (frame as { params?: { prompt?: { text?: string }[] } }).params
    ?.prompt;
  return (prompt ?? []).map((block) => block.text ?? "");
}

async function turnRunning(): Promise<{ world: World; bob: Client }> {
  const world = createWorld();
  const bob = world.connect();
  bob.send(frames.initialize(1));
  world.harness().replyTo("initialize", {
    _meta: { steering: { supported: true } },
  });
  bob.send(frames.newSession(2));
  world.harness().replyTo("session/new", { sessionId: SESSION });
  await settle();
  bob.send(uiPrompt(3, "My name is Petr, say hi."));
  await settle();
  return { world, bob };
}

describe("acp-runtime: steer points", () => {
  /**
   * TEST_SCENARIO: The agent is generating — from the turn's start, and while
   * it writes its reply. A steer now would abort it mid-sentence, so the
   * prompts must wait, and start as the next turn once the reply ends.
   */
  it("does not steer into a reply the agent is writing", async () => {
    const { world, bob } = await turnRunning();

    bob.send(uiPrompt(4, "and also this"));
    await settle();
    expect(world.harness().received(STEER_METHOD)).toEqual([]);

    world.harness().emit(frames.agentMessage(SESSION, "I'm here, Petr"));
    bob.send(uiPrompt(5, "your mother"));
    await settle();
    expect(world.harness().received(STEER_METHOD)).toEqual([]);

    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    await settle();
    expect(world.harness().received("session/prompt")).toHaveLength(2);
    expect(world.harness().received(STEER_METHOD)).toEqual([]);
  });

  /**
   * TEST_SCENARIO: The agent is running a tool. The prompt must wait for the
   * tool to finish, then be steered at once — before the agent writes again —
   * so it reads the prompt next to the tool's result.
   */
  it("steers right after the agent's tool calls finish", async () => {
    const { world, bob } = await turnRunning();
    world.harness().emit(
      update({
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        status: "in_progress",
      }),
    );

    bob.send(uiPrompt(4, "I changed my mind"));
    await settle();
    expect(world.harness().received(STEER_METHOD)).toEqual([]);

    world.harness().emit(
      update({
        sessionUpdate: "tool_call_update",
        toolCallId: "t1",
        status: "completed",
      }),
    );
    await settle();
    expect(world.harness().received(STEER_METHOD)).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: Two messages wait while a tool runs. A later message may
   * change what an earlier one asked, so the agent must read them together:
   * the steer point after the tool takes both, as one steer carrying each in
   * the order they were sent.
   */
  it("steers everything waiting as one batch, in order", async () => {
    const { world, bob } = await turnRunning();
    world.harness().emit(
      update({
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        status: "in_progress",
      }),
    );

    bob.send(uiPrompt(4, "be grumpy"));
    bob.send(uiPrompt(5, "be funny"));
    await settle();
    world.harness().emit(
      update({
        sessionUpdate: "tool_call_update",
        toolCallId: "t1",
        status: "completed",
      }),
    );
    await settle();

    const steers = world.harness().received(STEER_METHOD);
    expect(steers).toHaveLength(1);
    expect(promptTexts(steers[0])).toEqual(["be grumpy", "be funny"]);
  });

  /**
   * TEST_SCENARIO: The agent writes a single reply with no tool call, so no
   * steer point comes. The messages that waited must start the next turn
   * together, as one prompt, and each sender is answered when it ends.
   */
  it("starts everything waiting as one turn when the reply ends", async () => {
    const { world, bob } = await turnRunning();
    world.harness().emit(frames.agentMessage(SESSION, "Hi Petr"));

    bob.send(uiPrompt(4, "be grumpy"));
    bob.send(uiPrompt(5, "be funny"));
    bob.send(uiPrompt(6, "and brief"));
    await settle();
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    await settle();

    const prompts = world.harness().received("session/prompt");
    expect(prompts).toHaveLength(2);
    expect(promptTexts(prompts[1])).toEqual([
      "be grumpy",
      "be funny",
      "and brief",
    ]);

    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    await settle();
    for (const id of [4, 5, 6])
      expect(bob.reply(id)).toMatchObject({
        result: { stopReason: "end_turn" },
      });
  });

  /**
   * TEST_SCENARIO: Only messages typed in the chat batch. A prompt from
   * another surface — a channel, a schedule, the CLI — is its own turn.
   */
  it("keeps a prompt from another surface out of a batch", async () => {
    const { world, bob } = await turnRunning();
    world.harness().emit(frames.agentMessage(SESSION, "Hi Petr"));

    bob.send(frames.prompt(4, SESSION, "from the cli"));
    bob.send(uiPrompt(5, "be funny"));
    await settle();
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
    await settle();

    const prompts = world.harness().received("session/prompt");
    expect(promptTexts(prompts[1])).toEqual(["from the cli"]);
  });

  /**
   * TEST_SCENARIO: The user asks to send a queued message now. It must be
   * steered at once, even while the agent writes — the user accepts the cut.
   */
  it("steers a message the user sends now, even mid-reply", async () => {
    const { world, bob } = await turnRunning();
    world.harness().emit(frames.agentMessage(SESSION, "I'm here, Petr"));
    bob.send(uiPrompt(4, "stop, do this instead"));
    await settle();
    expect(world.harness().received(STEER_METHOD)).toEqual([]);

    bob.send({
      jsonrpc: "2.0",
      id: 5,
      method: "platform/steerQueued",
      params: { sessionId: SESSION, promptId: "p4" },
    });
    await settle();
    expect(world.harness().received(STEER_METHOD)).toHaveLength(1);
  });
});
