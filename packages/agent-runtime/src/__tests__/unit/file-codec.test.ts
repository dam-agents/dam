import { describe, expect, it } from "vitest";
import {
  parseFile,
  serializeFile,
} from "../../modules/runtime-channel/infrastructure/file-codec.js";

describe("file-codec", () => {
  it("round-trips json (2-space, trailing newline)", () => {
    const obj = { a: 1, b: { c: "x" } };
    const s = serializeFile("json", obj);
    expect(s.endsWith("\n")).toBe(true);
    expect(parseFile("json", s)).toEqual(obj);
  });

  it("round-trips toml, including nested tables", () => {
    const obj = { model: "gpt", nested: { effort: "high" } };
    expect(parseFile("toml", serializeFile("toml", obj))).toEqual(obj);
  });

  it("round-trips yaml", () => {
    const obj = { a: 1, list: [1, 2] };
    expect(parseFile("yaml", serializeFile("yaml", obj))).toEqual(obj);
  });

  it("parses empty content as an empty object for structured formats", () => {
    expect(parseFile("json", "")).toEqual({});
    expect(parseFile("toml", "")).toEqual({});
    expect(parseFile("yaml", "")).toEqual({});
  });

  it("treats text/ini as opaque strings on parse", () => {
    expect(parseFile("text", "hello")).toBe("hello");
    expect(parseFile("ini", "a=b")).toBe("a=b");
  });

  it("throws on malformed json/toml (so callers can probe)", () => {
    expect(() => parseFile("json", "{ not json")).toThrow();
    expect(() => parseFile("toml", "= nope")).toThrow();
  });
});
