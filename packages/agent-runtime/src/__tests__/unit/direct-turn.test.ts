import { describe, it, expect } from "vitest";
import {
  directTurnContract,
  frameDirectTurn,
} from "../../modules/acp/domain/direct-turn.js";

/**
 * TEST_OVERVIEW: framing a direct turn. A prompt typed in the UI or the CLI
 * into a Session that also lives in a messenger thread carries the
 * how-to-respond contract. The contract joins the prompt's first text block,
 * so the harness sees the same block layout a web-chat prompt has: typed text
 * stays one text block, and attachments keep their own blocks and order. Only
 * a prompt with no text block at all gets the contract as a block of its own.
 */

function promptFrame(prompt: unknown): object {
  return {
    jsonrpc: "2.0",
    id: 7,
    method: "session/prompt",
    params: { sessionId: "s1", prompt },
  };
}

function framedPrompt(prompt: unknown): unknown {
  return (
    frameDirectTurn(promptFrame(prompt)) as { params: { prompt: unknown } }
  ).params.prompt;
}

const contract = directTurnContract();

describe("frameDirectTurn", () => {
  /**
   * TEST_SCENARIO: A plain typed message is one text block. It must stay one
   * block after framing, with the contract ahead of what the person typed.
   */
  it("keeps a single text prompt a single text block", () => {
    expect(framedPrompt([{ type: "text", text: "is there a bug?" }])).toEqual([
      { type: "text", text: `${contract}\n\nis there a bug?` },
    ]);
  });

  /**
   * TEST_SCENARIO: A message with attachments puts the attachment blocks
   * before the typed text. The contract joins that text block; the attachment
   * blocks are passed through untouched and in their order.
   */
  it("merges the contract into the first text block when attachments come first", () => {
    const image = { type: "image", data: "aGk=", mimeType: "image/png" };
    const file = {
      type: "resource_link",
      uri: "file:///work/q.pdf",
      name: "q.pdf",
    };
    expect(
      framedPrompt([image, file, { type: "text", text: "read these" }]),
    ).toEqual([
      image,
      file,
      { type: "text", text: `${contract}\n\nread these` },
    ]);
  });

  /**
   * TEST_SCENARIO: Only the first text block carries the contract; later text
   * blocks stay exactly as the client sent them.
   */
  it("frames only the first of several text blocks", () => {
    expect(
      framedPrompt([
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ]),
    ).toEqual([
      { type: "text", text: `${contract}\n\nfirst` },
      { type: "text", text: "second" },
    ]);
  });

  /**
   * TEST_SCENARIO: A prompt made only of attachments has no text to join, so
   * the contract still reaches the agent as a text block of its own.
   */
  it("prepends the contract as its own block when the prompt has no text", () => {
    const image = { type: "image", data: "aGk=", mimeType: "image/png" };
    expect(framedPrompt([image])).toEqual([
      { type: "text", text: contract },
      image,
    ]);
  });

  /**
   * TEST_SCENARIO: The caller keeps the original frame for the Session
   * Transcript and the echo to other viewers, so framing must not change it.
   */
  it("leaves the original frame untouched", () => {
    const original = promptFrame([{ type: "text", text: "hi" }]);
    const snapshot = structuredClone(original);
    frameDirectTurn(original);
    expect(original).toEqual(snapshot);
  });

  it("passes a frame without a prompt array through unchanged", () => {
    const frame = {
      jsonrpc: "2.0",
      id: 1,
      method: "session/prompt",
      params: {},
    };
    expect(frameDirectTurn(frame)).toBe(frame);
  });
});
