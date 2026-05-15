import { describe, expect, it } from "vitest";
import { resolveConfig } from "../modules/cli/domain/config.js";

describe("resolveConfig precedence", () => {
  it.each([
    {
      name: "flag overrides env overrides file",
      sources: {
        flag: { server: "https://flag" },
        env: { server: "https://env" },
        file: { server: "https://file" },
      },
      expected: "https://flag",
    },
    {
      name: "file-only is honored when neither flag nor env is set",
      sources: { env: {}, file: { server: "https://file" } },
      expected: "https://file",
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
