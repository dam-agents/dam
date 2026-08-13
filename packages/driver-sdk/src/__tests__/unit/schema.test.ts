import { describe, it, expect } from "vitest";
import { s } from "../../schema.js";

describe("s() schema sugar", () => {
  it("expands a primitive name", () => {
    expect(s("integer")).toEqual({ type: "integer" });
    expect(s("string")).toEqual({ type: "string" });
    expect(s("boolean")).toEqual({ type: "boolean" });
    expect(s("null")).toEqual({ type: "null" });
  });

  it("rejects an unknown primitive", () => {
    expect(() => s("int")).toThrow(/unknown shorthand type "int"/);
  });

  it("expands an object with all fields required by default", () => {
    expect(s({ pass: "boolean", note: "string" })).toEqual({
      type: "object",
      properties: { pass: { type: "boolean" }, note: { type: "string" } },
      required: ["pass", "note"],
      additionalProperties: false,
    });
  });

  it("treats a trailing '?' as an optional field", () => {
    expect(s({ score: "number?" })).toEqual({
      type: "object",
      properties: { score: { type: "number" } },
      required: [],
      additionalProperties: false,
    });
  });

  it("keeps required and optional fields separate", () => {
    const out = s({ pass: "boolean", score: "number?" });
    expect(out.required).toEqual(["pass"]);
  });

  it("expands an array of a primitive", () => {
    expect(s(["string"])).toEqual({
      type: "array",
      items: { type: "string" },
    });
  });

  it("expands an empty array to items: any", () => {
    expect(s([])).toEqual({ type: "array", items: {} });
  });

  it("nests objects and arrays", () => {
    expect(s({ rows: [{ id: "string" }] })).toEqual({
      type: "object",
      properties: {
        rows: {
          type: "array",
          items: {
            type: "object",
            properties: { id: { type: "string" } },
            required: ["id"],
            additionalProperties: false,
          },
        },
      },
      required: ["rows"],
      additionalProperties: false,
    });
  });

  it("treats a field named like a JSON Schema keyword as raw passthrough", () => {
    const spec = { items: [{ id: "string" }] };
    expect(s(spec)).toBe(spec);
  });

  it("passes a raw JSON Schema object through untouched", () => {
    const raw = { type: "object", properties: { x: { type: "number" } } };
    expect(s(raw)).toBe(raw);
    expect(s({ enum: ["a", "b"] })).toEqual({ enum: ["a", "b"] });
  });

  it("supports s.enum() for enum fields", () => {
    expect(s.enum(["passed", "continue"])).toEqual({
      enum: ["passed", "continue"],
    });
    expect(s({ verdict: s.enum(["passed", "continue"]) })).toEqual({
      type: "object",
      properties: { verdict: { enum: ["passed", "continue"] } },
      required: ["verdict"],
      additionalProperties: false,
    });
  });
});
