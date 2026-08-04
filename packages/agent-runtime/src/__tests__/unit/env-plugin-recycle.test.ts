import { describe, it, expect } from "vitest";
import type { Contribution, DispatchContext } from "agent-runtime-api";
import {
  createEnvPlugin,
  type EnvChange,
} from "../../modules/runtime-channel/drivers/env-plugin.js";
import type { EnvStateStore } from "../../modules/runtime-channel/infrastructure/env-state-store.js";

const ctx: DispatchContext = {
  agentHome: "/home/agent",
  pluginStateDir: "/home/agent/.platform",
  log: () => {},
};

function env(name: string, placeholder: string): Contribution {
  return { kind: "env", name, placeholder };
}

function harness(initial: Record<string, string>) {
  let value = initial;
  const changes: EnvChange[] = [];
  const store: EnvStateStore = {
    current: () => value,
    write: (e) => {
      value = e;
    },
    ready: () => true,
  };
  const handler = createEnvPlugin({
    store,
    onChange: (c) => changes.push(c),
  }).bind!("env", { impl: "env" });
  return { apply: (c: Contribution[]) => handler(c, ctx), changes, store };
}

describe("env driver change classification (#3143)", () => {
  it("a value-only change is written but reported as namesChanged: false", async () => {
    const h = harness({
      GH_TOKEN: "old-value",
      PLATFORM_GH_TOKEN_AVAILABLE: "true",
    });
    await h.apply([env("GH_TOKEN", "rotated-value")]);
    expect(h.changes).toEqual([{ namesChanged: false }]);
    expect(h.store.current().GH_TOKEN).toBe("rotated-value");
  });

  it("an added or removed variable reports namesChanged: true", async () => {
    const h = harness({
      GH_TOKEN: "v",
      PLATFORM_GH_TOKEN_AVAILABLE: "true",
    });
    await h.apply([env("GH_TOKEN", "v"), env("NEW_VAR", "x")]);
    expect(h.changes).toEqual([{ namesChanged: true }]);
  });

  it("an unchanged env fires no change at all", async () => {
    const h = harness({
      GH_TOKEN: "v",
      PLATFORM_GH_TOKEN_AVAILABLE: "true",
    });
    await h.apply([env("GH_TOKEN", "v")]);
    expect(h.changes).toEqual([]);
  });

  it("removing a variable named after an Object.prototype member is a set change", async () => {
    const h = harness({
      toString: "x",
      NEW_VAR: "y",
      PLATFORM_GH_TOKEN_AVAILABLE: "false",
    });
    await h.apply([env("NEW_VAR", "y"), env("OTHER", "z")]);
    expect(h.changes).toEqual([{ namesChanged: true }]);
  });
});
