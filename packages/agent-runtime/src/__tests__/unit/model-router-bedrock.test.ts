/**
 * TEST_OVERVIEW: The Model Router passes a Bedrock Connection's calls on
 * unchanged. It knows the Connection from its `/bedrock/<id>` path, bills
 * only the model paths, and reads a streamed call's usage from the AWS
 * event-stream frames as they pass, an invoke call's (Claude Code) and a
 * Converse call's (Pi), leaving every byte as it was.
 */
import { describe, expect, it } from "vitest";
import {
  createBedrockUsageScanner,
  type BedrockUsageScanner,
} from "../../modules/model-router/index.js";

function frame(event: unknown, invoke = true): Buffer {
  const headers = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]);
  const payload = Buffer.from(
    JSON.stringify(
      invoke
        ? { bytes: Buffer.from(JSON.stringify(event)).toString("base64") }
        : event,
    ),
  );
  const total = 12 + headers.length + payload.length + 4;
  const prelude = Buffer.alloc(12);
  prelude.writeUInt32BE(total, 0);
  prelude.writeUInt32BE(headers.length, 4);
  return Buffer.concat([prelude, headers, payload, Buffer.alloc(4)]);
}

async function pass(
  scanner: BedrockUsageScanner,
  chunks: Buffer[],
): Promise<Buffer> {
  const out: Buffer[] = [];
  scanner.on("data", (c: Buffer) => out.push(c));
  for (const c of chunks) scanner.write(c);
  scanner.end();
  await new Promise((resolve) => scanner.on("end", resolve));
  return Buffer.concat(out);
}

describe("Bedrock event stream", () => {
  /** TEST_SCENARIO: Claude Code streams an invoke call on Bedrock. The frames
   * arrive split at arbitrary byte boundaries; Claude Code must receive them
   * byte for byte, and the router's call record must still carry the input
   * tokens of message_start and the output tokens of message_delta. */
  it("reads usage from frames split across chunks and passes every byte", async () => {
    const stream = Buffer.concat([
      frame({
        type: "message_start",
        message: { usage: { input_tokens: 11, cache_read_input_tokens: 3 } },
      }),
      frame({ type: "content_block_delta", delta: { text: "hi" } }),
      frame({ type: "message_delta", usage: { output_tokens: 5 } }),
    ]);
    const chunks = [
      stream.subarray(0, 7),
      stream.subarray(7, 90),
      stream.subarray(90),
    ];
    const scanner = createBedrockUsageScanner();
    const out = await pass(scanner, chunks);
    expect(out.equals(stream)).toBe(true);
    expect(scanner.completed()).toBe(true);
    expect(scanner.usage()).toMatchObject({
      inputTokens: 11,
      outputTokens: 5,
      cacheReadTokens: 3,
    });
  });

  /** TEST_SCENARIO: Pi streams a Converse call on Bedrock, whose frames carry
   * the events themselves; the call's usage, cache reads and writes included,
   * comes in the closing metadata event. */
  it("reads a Converse stream's usage from its metadata event", async () => {
    const stream = Buffer.concat([
      frame({ contentBlockIndex: 0, delta: { text: "hi" } }, false),
      frame({ stopReason: "end_turn" }, false),
      frame(
        {
          usage: {
            inputTokens: 9,
            outputTokens: 4,
            cacheReadInputTokens: 2,
            cacheWriteInputTokens: 1,
          },
          metrics: { latencyMs: 10 },
        },
        false,
      ),
    ]);
    const scanner = createBedrockUsageScanner(false);
    const out = await pass(scanner, [
      stream.subarray(0, 30),
      stream.subarray(30),
    ]);
    expect(out.equals(stream)).toBe(true);
    expect(scanner.completed()).toBe(true);
    expect(scanner.usage()).toEqual({
      inputTokens: 9,
      outputTokens: 4,
      cacheReadTokens: 2,
      cacheCreationTokens: 1,
    });
  });
});
