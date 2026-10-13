import { describe, it, expect } from "vitest";
import {
  parseFrame,
  isRequest,
  isResponse,
} from "../../modules/acp/domain/frames.js";

describe("frames", () => {
  it("parseFrame parses a JSON object and returns null for anything else", () => {
    expect(parseFrame('{"id":1,"method":"x"}')).toEqual({
      id: 1,
      method: "x",
    });
    expect(parseFrame("not json")).toBeNull();
    expect(parseFrame('"string"')).toBeNull();
    expect(parseFrame("42")).toBeNull();
    expect(parseFrame("null")).toBeNull();
  });

  it("isRequest matches id + method, not notifications or responses", () => {
    expect(isRequest({ id: 1, method: "x" })).toBe(true);
    expect(isRequest({ id: "abc", method: "session/new" })).toBe(true);
    expect(isRequest({ method: "session/update" } as never)).toBe(false);
    expect(isRequest({ id: 1, result: {} } as never)).toBe(false);
  });

  it("isResponse matches id with result or error and no method", () => {
    expect(isResponse({ id: 1, result: {} })).toBe(true);
    expect(isResponse({ id: 1, error: {} })).toBe(true);
    expect(isResponse({ id: 1, method: "x", result: {} } as never)).toBe(false);
    expect(isResponse({ id: 1 } as never)).toBe(false);
    expect(isResponse({ method: "x" } as never)).toBe(false);
  });
});
