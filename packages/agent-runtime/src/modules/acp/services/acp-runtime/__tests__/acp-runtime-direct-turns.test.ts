import { describe, it, expect } from "vitest";
import { directTurnContract } from "../../../domain/direct-turn.js";
import { createSessionMetadata, createWorld, type Frame } from "./acp-world.js";

/**
 * TEST_OVERVIEW: direct turns in a Session that also lives in a messenger
 * thread. A prompt marked with the UI or CLI surface is framed with the
 * how-to-respond contract before it reaches the harness. The harness gets the
 * contract inside the prompt's own text block, so the prompt has the same
 * block layout as one typed into a web-chat Session. The Session Transcript
 * and the echo to other viewers keep only what the person typed.
 */

const SESSION = "sess-thread";

function openThreadSession(world: ReturnType<typeof createWorld>) {
  const client = world.connect();
  client.send({
    jsonrpc: "2.0",
    id: 1,
    method: "session/new",
    params: {
      cwd: ".",
      _meta: { platform: { type: "channel_slack", threadTs: "C1:170.1" } },
    },
  });
  world.harness().replyTo("session/new", { sessionId: SESSION });
  return client;
}

function uiPrompt(id: number, text: string): object {
  return {
    jsonrpc: "2.0",
    id,
    method: "session/prompt",
    params: {
      sessionId: SESSION,
      prompt: [{ type: "text", text }],
      _meta: { platform: { promptId: `p-${id}`, surface: "ui" } },
    },
  };
}

function forwardedPrompt(world: ReturnType<typeof createWorld>): unknown {
  const [frame] = world.harness().received("session/prompt");
  return (frame?.params as { prompt?: unknown } | undefined)?.prompt;
}

function userChunksOf(frames: Frame[]): unknown[] {
  return frames
    .map((f) => (f.params as { update?: Record<string, unknown> }).update)
    .filter((u) => u?.sessionUpdate === "user_message_chunk")
    .map((u) => u?.content);
}

describe("acp-runtime: direct turns in a thread Session", () => {
  /**
   * TEST_SCENARIO: A message typed in the UI into a Slack-started Session is
   * one text block. The harness must receive one text block too, the contract
   * ahead of the typed text, never the contract as a block of its own.
   */
  it("should forward the framed prompt as a single text block", () => {
    const world = createWorld({
      sessionMetadata: createSessionMetadata().store,
    });
    const client = openThreadSession(world);

    client.send(uiPrompt(2, "is there actually a bug?"));

    expect(forwardedPrompt(world)).toEqual([
      {
        type: "text",
        text: `${directTurnContract()}\n\nis there actually a bug?`,
      },
    ]);
  });

  /**
   * TEST_SCENARIO: Another viewer of the Session sees the prompt through the
   * runtime's echo. The echo must carry only the typed text, so the contract
   * never shows up as part of the person's message.
   */
  it("should echo only the typed text to other viewers", () => {
    const world = createWorld({
      sessionMetadata: createSessionMetadata().store,
    });
    const client = openThreadSession(world);
    const viewer = world.connect();
    viewer.send({
      jsonrpc: "2.0",
      id: 9,
      method: "session/resume",
      params: { sessionId: SESSION, cwd: "." },
    });

    client.send(uiPrompt(2, "is there actually a bug?"));

    expect(userChunksOf(viewer.saw("session/update"))).toEqual([
      { type: "text", text: "is there actually a bug?" },
    ]);
  });

  /**
   * TEST_SCENARIO: A Session with no messenger thread is not framed at all:
   * the harness receives the prompt blocks exactly as the UI sent them.
   */
  it("should not frame a prompt in a Session without a thread", () => {
    const world = createWorld({
      sessionMetadata: createSessionMetadata().store,
    });
    const client = world.connect();
    client.send({
      jsonrpc: "2.0",
      id: 1,
      method: "session/new",
      params: { cwd: "." },
    });
    world.harness().replyTo("session/new", { sessionId: SESSION });

    client.send(uiPrompt(2, "hello"));

    expect(forwardedPrompt(world)).toEqual([{ type: "text", text: "hello" }]);
  });
});
