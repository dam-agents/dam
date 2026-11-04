// TEST_OVERVIEW: The terminal wire carries the client's window size as two 16-bit numbers. A zero dimension is a size no PTY can take, and the agent runtime drops a frame it cannot decode, so a client whose window is not laid out yet (the CLI reports 0×0 when its stdout is not a TTY) is ignored instead of taking the runtime down with the PTY library's throw.
import { describe, expect, it } from "vitest";
import { OP_RESIZE, decodeFrame, encodeResize } from "api-server-api";

describe("terminal resize frames", () => {
  it("round-trips a size a PTY can take", () => {
    expect(decodeFrame(encodeResize(120, 40))).toEqual({
      op: OP_RESIZE,
      cols: 120,
      rows: 40,
    });
  });

  // TEST_SCENARIO: a client opens a connection from a 0×0 window; the runtime must read the frame as unusable rather than hand 0 to the PTY, because node-pty throws on a zero dimension and the throw escapes the socket's message handler.
  it("refuses a zero dimension", () => {
    expect(() => decodeFrame(encodeResize(0, 40))).toThrow(
      /positive cols and rows/,
    );
    expect(() => decodeFrame(encodeResize(120, 0))).toThrow(
      /positive cols and rows/,
    );
  });
});
