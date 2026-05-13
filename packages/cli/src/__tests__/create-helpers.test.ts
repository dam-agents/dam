import { describe, it, expect } from "vitest";
import {
  parseEnvFlag,
  validateInstanceName,
} from "../modules/instances/commands/create-helpers.js";

describe("parseEnvFlag", () => {
  it("parses KEY=VAL into a single EnvVar", () => {
    const r = parseEnvFlag(["KEY=VAL"]);
    expect(r).toEqual({ ok: true, value: [{ name: "KEY", value: "VAL" }] });
  });

  it("preserves empty values (KEY=)", () => {
    const r = parseEnvFlag(["KEY="]);
    expect(r).toEqual({ ok: true, value: [{ name: "KEY", value: "" }] });
  });

  it("rejects entries without an equals sign", () => {
    const r = parseEnvFlag(["KEY"]);
    expect(r).toEqual({ ok: false, error: { kind: "missing-equals", input: "KEY" } });
  });

  it("rejects names that don't match [A-Z_][A-Z0-9_]*", () => {
    const r = parseEnvFlag(["123KEY=foo"]);
    expect(r).toEqual({ ok: false, error: { kind: "invalid-name", key: "123KEY" } });
  });

  it("splits on the first `=` so the value may contain more", () => {
    const r = parseEnvFlag(["KEY=a=b=c"]);
    expect(r).toEqual({ ok: true, value: [{ name: "KEY", value: "a=b=c" }] });
  });

  it("on duplicate keys, last wins silently", () => {
    const r = parseEnvFlag(["KEY=1", "KEY=2"]);
    expect(r).toEqual({ ok: true, value: [{ name: "KEY", value: "2" }] });
  });
});

describe("validateInstanceName", () => {
  it("accepts a normal name", () => {
    expect(validateInstanceName("foo").ok).toBe(true);
  });

  it("accepts names that merely contain `inst-` (only the literal prefix is reserved)", () => {
    expect(validateInstanceName("instance-foo").ok).toBe(true);
  });

  it("rejects names starting with `inst-`", () => {
    expect(validateInstanceName("inst-foo")).toEqual({ ok: false, error: "reserved-prefix" });
  });

  it("rejects the empty string", () => {
    expect(validateInstanceName("")).toEqual({ ok: false, error: "empty" });
  });
});
