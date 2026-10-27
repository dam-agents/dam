/**
 * TEST_OVERVIEW: The Model Router passes a Bedrock Connection's calls on
 * unchanged. It knows the Connection from its `/bedrock/<id>` path, bills
 * only the model paths, and reads a streamed call's usage from the AWS
 * event-stream frames as they pass, leaving every byte as it was.
 */
import { describe, expect, it } from "vitest";
import {
  createBedrockUsageScanner,
  type BedrockUsageScanner,
} from "../../modules/model-router/index.js";

function frame(event: unknown): Buffer {
  const headers = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]);
  const payload = Buffer.from(
    JSON.stringify({
      bytes: Buffer.from(JSON.stringify(event)).toString("base64"),
    }),
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
});
