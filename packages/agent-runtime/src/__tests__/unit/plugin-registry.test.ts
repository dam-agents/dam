import { describe, it, expect } from "vitest";
import type { Plugin } from "agent-runtime-api";
import { createPluginRegistry } from "../../modules/runtime-channel/infrastructure/plugin-registry.js";

function noopPlugin(name: string): Plugin {
  return {
    name,
    bind: () => async () => {},
  };
}

describe("PluginRegistry", () => {
  it("registers and resolves a plugin by name", () => {
    const registry = createPluginRegistry();
    registry.register(noopPlugin("file"));
    expect(registry.get("file")?.name).toBe("file");
  });

  it("returns null for unknown names", () => {
    const registry = createPluginRegistry();
    expect(registry.get("nope")).toBeNull();
  });

  it("throws on duplicate registration — extensions can't shadow built-ins", () => {
    const registry = createPluginRegistry();
    registry.register(noopPlugin("file"));
    expect(() => registry.register(noopPlugin("file"))).toThrow(
      /already registered/,
    );
  });

  it("exposes the registered names for diagnostics", () => {
    const registry = createPluginRegistry();
    registry.register(noopPlugin("a"));
    registry.register(noopPlugin("b"));
    expect([...registry.names()].sort()).toEqual(["a", "b"]);
  });
});
