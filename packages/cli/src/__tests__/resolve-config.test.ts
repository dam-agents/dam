import { describe, expect, it } from "vitest";
import { resolveConfig } from "../modules/cli/domain/config.js";

describe("resolveConfig precedence", () => {
  it.each([
    {
      name: "flag-only",
      sources: { flag: { server: "https://flag" }, env: {}, file: {} },
      expected: "https://flag",
    },
    {
      name: "env-only",
      sources: { env: { server: "https://env" }, file: {} },
      expected: "https://env",
    },
    {
      name: "file-only",
      sources: { env: {}, file: { server: "https://file" } },
      expected: "https://file",
    },
    {
      name: "flag overrides env",
      sources: {
        flag: { server: "https://flag" },
        env: { server: "https://env" },
        file: {},
      },
      expected: "https://flag",
    },
    {
      name: "env overrides file",
      sources: {
        env: { server: "https://env" },
        file: { server: "https://file" },
      },
      expected: "https://env",
    },
    {
      name: "flag overrides env overrides file",
      sources: {
        flag: { server: "https://flag" },
        env: { server: "https://env" },
        file: { server: "https://file" },
      },
      expected: "https://flag",
    },
  ])("$name", ({ sources, expected }) => {
    const r = resolveConfig(sources);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.server).toBe(expected);
  });

  it("returns MissingConfigError naming the missing key when nothing is set", () => {
    const r = resolveConfig({ env: {}, file: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("missing-config");
      expect(r.error.key).toBe("server");
    }
  });
});
