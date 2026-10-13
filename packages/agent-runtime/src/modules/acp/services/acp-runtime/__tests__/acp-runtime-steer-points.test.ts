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
   * TEST_SCENARIO: The agent is writing its reply. A steer now would abort it
   * mid-sentence, so the prompt must wait, and start as the next turn once
   * the reply ends.
   */
  it("does not steer into a reply the agent is writing", async () => {
    const { world, bob } = await turnRunning();
    world.harness().emit(frames.agentMessage(SESSION, "I'm here, Petr"));

    bob.send(uiPrompt(4, "your mother"));
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
   * TEST_SCENARIO: Before the agent has run a tool, it is generating — the
   * harness would abort that generation too — so the turn's start is no
   * steer point either.
   */
  it("does not steer before the agent's first tool call", async () => {
    const { world, bob } = await turnRunning();

    bob.send(uiPrompt(4, "and also this"));
    await settle();
    expect(world.harness().received(STEER_METHOD)).toEqual([]);
  });

  /**
   * TEST_SCENARIO: Two messages wait while a tool runs. Steered together at
   * one steer point, the harness merges them into a single user message —
   * once even in the wrong order. A steer starts the agent generating again,
   * so only the first is steered there; the second waits for the next steer
   * point and reaches the agent on its own.
   */
  it("steers one message per steer point", async () => {
    const { world, bob } = await turnRunning();
    const tool = (id: string, status: string, kind = "tool_call_update") =>
      world
        .harness()
        .emit(update({ sessionUpdate: kind, toolCallId: id, status }));
    tool("t1", "in_progress", "tool_call");

    bob.send(uiPrompt(4, "be grumpy"));
    bob.send(uiPrompt(5, "be funny"));
    await settle();
    tool("t1", "completed");
    await settle();
    expect(world.harness().received(STEER_METHOD)).toHaveLength(1);

    world.harness().replyTo(STEER_METHOD, { outcome: "injected" });
    await settle();
    expect(world.harness().received(STEER_METHOD)).toHaveLength(1);

    tool("t2", "in_progress", "tool_call");
    tool("t2", "completed");
    await settle();
    expect(world.harness().received(STEER_METHOD)).toHaveLength(2);
  });
});
