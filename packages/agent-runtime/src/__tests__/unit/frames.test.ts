import { describe, it, expect } from "vitest";
import {
  parseFrame,
  isRequest,
  isResponse,
} from "../../modules/acp/domain/frames.js";

describe("frames", () => {
  describe("parseFrame", () => {
    it("parses valid JSON", () => {
      expect(parseFrame('{"id":1,"method":"x"}')).toEqual({
        id: 1,
        method: "x",
      });
    });

    it("returns null for invalid JSON", () => {
      expect(parseFrame("not json")).toBeNull();
    });

    it("returns null for non-object JSON", () => {
      expect(parseFrame('"string"')).toBeNull();
      expect(parseFrame("42")).toBeNull();
      expect(parseFrame("null")).toBeNull();
    });
  });

  describe("isRequest", () => {
    it("matches frames with id + method", () => {
      expect(isRequest({ id: 1, method: "x" })).toBe(true);
      expect(isRequest({ id: "abc", method: "session/new" })).toBe(true);
    });

    it("rejects notifications (no id)", () => {
      expect(isRequest({ method: "session/update" } as never)).toBe(false);
    });

    it("rejects responses (no method)", () => {
      expect(isRequest({ id: 1, result: {} } as never)).toBe(false);
    });
  });

  describe("isResponse", () => {
    it("matches frames with id and result/error but no method", () => {
      expect(isResponse({ id: 1, result: {} })).toBe(true);
      expect(isResponse({ id: 1, error: {} })).toBe(true);
    });

    it("rejects requests (has method)", () => {
      expect(isResponse({ id: 1, method: "x", result: {} } as never)).toBe(
        false,
      );
    });

    it("rejects frames missing both result and error", () => {
      expect(isResponse({ id: 1 } as never)).toBe(false);
    });

    it("rejects notifications (no id)", () => {
      expect(isResponse({ method: "x" } as never)).toBe(false);
    });
  });
});
