import { describe, it, expect } from "vitest";
import {
  parseEnvFlag,
  validateAgentName,
} from "../modules/agent/commands/create-helpers.js";

describe("parseEnvFlag", () => {
  it("parses KEY=VAL into a single EnvVar", () => {
    const r = parseEnvFlag(["KEY=VAL"]);
    expect(r).toEqual({
      ok: true,
      value: { vars: [{ name: "KEY", value: "VAL" }], duplicates: [] },
    });
  });

  it("preserves empty values (KEY=)", () => {
    const r = parseEnvFlag(["KEY="]);
    expect(r).toEqual({
      ok: true,
      value: { vars: [{ name: "KEY", value: "" }], duplicates: [] },
    });
  });

  it("rejects entries without an equals sign", () => {
    const r = parseEnvFlag(["KEY"]);
    expect(r).toEqual({
      ok: false,
      error: { kind: "missing-equals", input: "KEY" },
    });
  });

  it("rejects names that don't match [A-Z_][A-Z0-9_]*", () => {
    const r = parseEnvFlag(["123KEY=foo"]);
    expect(r).toEqual({
      ok: false,
      error: { kind: "invalid-name", key: "123KEY" },
    });
  });

  it("splits on the first `=` so the value may contain more", () => {
    const r = parseEnvFlag(["KEY=a=b=c"]);
    expect(r).toEqual({
      ok: true,
      value: { vars: [{ name: "KEY", value: "a=b=c" }], duplicates: [] },
    });
  });

  it("on duplicate keys, last wins and the key is reported in `duplicates`", () => {
    const r = parseEnvFlag(["KEY=1", "KEY=2"]);
    expect(r).toEqual({
      ok: true,
      value: { vars: [{ name: "KEY", value: "2" }], duplicates: ["KEY"] },
    });
  });

  it("collapses repeated duplicates of the same key to one entry", () => {
    const r = parseEnvFlag(["KEY=1", "KEY=2", "KEY=3"]);
    expect(r).toEqual({
      ok: true,
      value: { vars: [{ name: "KEY", value: "3" }], duplicates: ["KEY"] },
    });
  });
});

describe("validateAgentName", () => {
  it("accepts a normal name", () => {
    expect(validateAgentName("foo").ok).toBe(true);
  });

  it("accepts names that merely contain `agent-` (only the literal prefix is reserved)", () => {
    expect(validateAgentName("my-agent-foo").ok).toBe(true);
  });

  it("rejects names starting with `agent-`", () => {
    expect(validateAgentName("agent-foo")).toEqual({
      ok: false,
      error: "reserved-prefix",
    });
  });

  it("rejects the empty string", () => {
    expect(validateAgentName("")).toEqual({ ok: false, error: "empty" });
  });
});
