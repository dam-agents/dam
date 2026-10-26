import { describe, expect, it } from "vitest";
import { createWorld, frames, type Client } from "./acp-world.js";

/**
 * TEST_OVERVIEW: the output of a local command reaches the Session once.
 * Claude Code answers a command such as `/context` without a model call, and
 * its adapter sends the output twice in the prompt turn: as the CLI's
 * synthetic reply, and again from the turn's result text, as another agent
 * message with its own messageId. The second copy can end in white space the
 * first one does not have. The runtime keeps the copy out of the Session
 * Transcript, so neither a live viewer nor a reload shows it.
 */

const SESSION = "sess-local";

const CONTEXT_OUTPUT =
  "## Context Usage\n\n**Tokens:** 15k / 1m (1%)\n\n| Category | Tokens |\n|---|---|\n| System prompt | 6k |";

function openSession(world: ReturnType<typeof createWorld>): Client {
  const client = world.connect();
  client.send(frames.newSession(1));
  world.harness().replyTo("session/new", { sessionId: SESSION });
  return client;
}

function agentTexts(client: Client): string[] {
  return client.saw("session/update").flatMap((frame) => {
    const update = (
      frame.params as {
        update?: { sessionUpdate?: string; content?: { text?: string } };
      }
    ).update;
    return update?.sessionUpdate === "agent_message_chunk" &&
      update.content?.text !== undefined
      ? [update.content.text]
      : [];
  });
}

function runCommand(
  world: ReturnType<typeof createWorld>,
  client: Client,
  id: number,
  command: string,
  outputs: { text: string; messageId: string }[],
): void {
  client.send(frames.prompt(id, SESSION, command));
  for (const { text, messageId } of outputs)
    world.harness().emit(frames.agentMessage(SESSION, text, messageId));
  world.harness().replyTo("session/prompt", { stopReason: "end_turn" });
}

describe("acp-runtime: local commands", () => {
  /**
   * TEST_SCENARIO: `/context` is answered with the synthetic reply and then
   * the result copy, which ends in two newlines. The viewer must see the
   * output once, and a reload of the Session must replay it once.
   */
  it("should show the output of /context once, live and after a reload", () => {
    const world = createWorld();
    const alice = openSession(world);

    runCommand(world, alice, 2, "/context", [
      { text: CONTEXT_OUTPUT, messageId: "m-synthetic" },
      { text: `${CONTEXT_OUTPUT}\n\n`, messageId: "m-result" },
    ]);

    expect(agentTexts(alice)).toEqual([CONTEXT_OUTPUT]);

    const bob = world.connect();
    bob.send(frames.loadSession(3, SESSION));
    expect(agentTexts(bob)).toEqual([CONTEXT_OUTPUT]);
  });

  /**
   * TEST_SCENARIO: The first copy can arrive in several chunks of one
   * message. The runtime must compare the copy with the whole message, so the
   * copy is still dropped and every chunk of the first message stays.
   */
  it("should drop the copy of an output that arrived in chunks", () => {
    const world = createWorld();
    const alice = openSession(world);

    runCommand(world, alice, 2, "/cost", [
      { text: "Total cost: $0.00\n", messageId: "m-1" },
      { text: "Total duration: 1s", messageId: "m-1" },
      { text: "Total cost: $0.00\nTotal duration: 1s", messageId: "m-2" },
    ]);

    expect(agentTexts(alice)).toEqual([
      "Total cost: $0.00\n",
      "Total duration: 1s",
    ]);
  });

  /**
   * TEST_SCENARIO: A model can answer a prompt with the same text twice on
   * purpose. Outside a slash command the runtime must not judge that, so a
   * prompt in plain words keeps both messages.
   */
  it("should keep a repeated message in a turn that is not a command", () => {
    const world = createWorld();
    const alice = openSession(world);

    runCommand(world, alice, 2, "say ok twice", [
      { text: "ok", messageId: "m-1" },
      { text: "ok", messageId: "m-2" },
    ]);

    expect(agentTexts(alice)).toEqual(["ok", "ok"]);
  });

  /**
   * TEST_SCENARIO: A command whose output differs from the message before it
   * is not a copy. Two `/context` turns in a row are two turns, so the second
   * output must be shown even when it equals the first one.
   */
  it("should keep the output of the next command turn", () => {
    const world = createWorld();
    const alice = openSession(world);

    runCommand(world, alice, 2, "/context", [
      { text: CONTEXT_OUTPUT, messageId: "m-1" },
      { text: CONTEXT_OUTPUT, messageId: "m-2" },
    ]);
    runCommand(world, alice, 3, "/context", [
      { text: CONTEXT_OUTPUT, messageId: "m-3" },
      { text: "Context low", messageId: "m-4" },
    ]);

    expect(agentTexts(alice)).toEqual([
      CONTEXT_OUTPUT,
      CONTEXT_OUTPUT,
      "Context low",
    ]);
  });

  /**
   * TEST_SCENARIO: A slash command can run the model, as a skill does. When
   * the model works between two messages, the second one is its own answer,
   * so it must be kept even when it repeats the first.
   */
  it("should keep a repeated message after the model worked", () => {
    const world = createWorld();
    const alice = openSession(world);

    alice.send(frames.prompt(2, SESSION, "/check-twice"));
    world.harness().emit(frames.agentMessage(SESSION, "All good.", "m-1"));
    world.harness().emit({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: SESSION,
        update: { sessionUpdate: "tool_call", toolCallId: "tc-1", title: "ls" },
      },
    });
    world.harness().emit(frames.agentMessage(SESSION, "All good.", "m-2"));
    world.harness().replyTo("session/prompt", { stopReason: "end_turn" });

    expect(agentTexts(alice)).toEqual(["All good.", "All good."]);
  });
});
