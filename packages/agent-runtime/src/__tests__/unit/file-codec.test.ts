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

  it("parses a comment-only yaml file as an empty object", () => {
    expect(parseFile("yaml", "# nothing set yet\n")).toEqual({});
  });

  it("throws on a yaml file with more than one document", () => {
    expect(() => parseFile("yaml", "a: 1\n---\nb: 2\n")).toThrow();
  });

  it("treats text as an opaque string on parse", () => {
    expect(parseFile("text", "hello")).toBe("hello");
  });

  /** TEST_SCENARIO: An AWS config names its sections `profile <name>` and
   * nests the s3 block as indented continuation lines under `s3 =`. A
   * key-targeted merge parses the file before it adds a section, so both
   * shapes must survive a parse and serialize round-trip byte for byte, or
   * every apply rewrites the file. */
  it("round-trips ini sections, spaced section names and continuation lines", () => {
    const value = {
      top: "1",
      "profile my conn": {
        region: "us-east-1",
        s3: "\n  addressing_style = path",
      },
    };
    const serialized = serializeFile("ini", value);
    expect(parseFile("ini", serialized)).toEqual(value);
    expect(serializeFile("ini", parseFile("ini", serialized))).toBe(serialized);
  });

  it("parses a hand-written ini, dropping comments and spacing", () => {
    expect(
      parseFile("ini", "# mine\n[default]\naws_access_key_id = AKIA ; x\n"),
    ).toEqual({ default: { aws_access_key_id: "AKIA ; x" } });
    expect(parseFile("ini", "")).toEqual({});
  });

  it("throws on malformed json/toml (so callers can probe)", () => {
    expect(() => parseFile("json", "{ not json")).toThrow();
    expect(() => parseFile("toml", "= nope")).toThrow();
  });
});
