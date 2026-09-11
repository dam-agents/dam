// TEST_OVERVIEW: a peer opens a connection, names the agent it wants on one newline-terminated line, and then speaks whatever protocol the caller speaks. TCP gives no guarantee about where that line lands: it can arrive split across segments, or share a segment with the bytes that follow it. Reading it as "whatever was in the first chunk" looked right on a loopback test and produced an empty agent name across two real nodes.
import { describe, expect, it } from "vitest";
import {
  MAX_HEADER_BYTES,
  readHeader,
} from "../../modules/nodes/infrastructure/peer-link.js";

const buf = (s: string) => Buffer.from(s, "utf8");

describe("reading the agent name off a peer connection", () => {
  it("waits while the line is incomplete", () => {
    expect(readHeader(buf("agent-"))).toEqual({ done: false, overflow: false });
  });

  // TEST_SCENARIO: the name and the request that follows it arrive in one segment — the common case once a client writes both without waiting.
  it("keeps the bytes that follow the line on the same segment", () => {
    const read = readHeader(buf("agent-1\nGET /healthz HTTP/1.1\r\n"));
    expect(read).toMatchObject({ done: true, agentId: "agent-1" });
    expect(read.done && read.rest.toString()).toBe("GET /healthz HTTP/1.1\r\n");
  });

  // TEST_SCENARIO: the name is split across segments, which is what produced an empty agent id between two nodes.
  it("joins a line split across segments", () => {
    expect(readHeader(buf("agent-abc"))).toMatchObject({ done: false });
    const read = readHeader(buf("agent-abc\nrest"));
    expect(read).toMatchObject({ done: true, agentId: "agent-abc" });
  });

  it("reports nothing left over when the line is all there was", () => {
    const read = readHeader(buf("agent-1\n"));
    expect(read.done && read.rest.length).toBe(0);
  });

  // TEST_SCENARIO: a peer that never sends a newline must not be able to grow this buffer without bound.
  it("gives up on a line that never ends", () => {
    expect(readHeader(buf("x".repeat(MAX_HEADER_BYTES + 1)))).toEqual({
      done: false,
      overflow: true,
    });
  });
});
