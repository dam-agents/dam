import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  Contribution,
  RuntimeChannelHelloInput,
  RuntimeChannelHelloResult,
  SignalEvent,
  StateEvent,
} from "api-server-api";
import { createBuiltinDriverRegistry } from "../../modules/runtime-channel/drivers/index.js";
import {
  applyState,
  createRuntimeChannelState,
  deliverSignal,
  type RuntimeChannelServiceDeps,
} from "../../modules/runtime-channel/service.js";

function makeDeps(agentHome: string): RuntimeChannelServiceDeps {
  return {
    state: createRuntimeChannelState(),
    registry: createBuiltinDriverRegistry(),
    driverContext: { agentHome, log: () => {} },
    serverClient: {
      async hello(
        _: RuntimeChannelHelloInput,
      ): Promise<RuntimeChannelHelloResult> {
        return { pendingSignals: [] };
      },
      async ack() {},
    },
    log: () => {},
  };
}

describe("runtime-channel service applyState", () => {
  it("writes a file contribution under the agent home", async () => {
    const home = mkdtempSync(join(tmpdir(), "runtime-channel-"));
    const deps = makeDeps(home);
    const contribs: Contribution[] = [
      {
        kind: "file",
        path: "subdir/hello.txt",
        content: "hi\n",
        mergeMode: "overwrite",
      },
    ];
    const state: StateEvent = {
      version: "v1",
      hash: "h1",
      contributions: contribs,
    };
    const result = await applyState(state, deps, () => {});
    expect(result.ok).toBe(true);
    expect(readFileSync(join(home, "subdir/hello.txt"), "utf8")).toBe("hi\n");
    expect(deps.state.appliedHash).toBe("h1");
    expect(deps.state.currentVersion).toBe("v1");
  });

  it("rejects an older version without applying", async () => {
    const home = mkdtempSync(join(tmpdir(), "runtime-channel-"));
    const deps = makeDeps(home);
    deps.state.currentVersion = "v2";
    deps.state.appliedHash = "h-already";
    const state: StateEvent = {
      version: "v1",
      hash: "h-new",
      contributions: [],
    };
    const result = await applyState(state, deps, () => {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rejected?.reason).toBe("older-version");
      expect(result.value.appliedHash).toBe("h-already");
    }
  });

  it("returns MissingCapability when a contribution kind is unknown", async () => {
    const home = mkdtempSync(join(tmpdir(), "runtime-channel-"));
    const deps = makeDeps(home);
    const state: StateEvent = {
      version: "v1",
      hash: "h1",
      // Cast to bypass discriminated union — simulating a server that
      // advertised a kind this agent doesn't support.
      contributions: [{ kind: "unknown", foo: 1 } as unknown as Contribution],
    };
    const result = await applyState(state, deps, () => {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("MissingCapability");
    }
  });

  it("short-circuits a no-op apply when the hash matches", async () => {
    const home = mkdtempSync(join(tmpdir(), "runtime-channel-"));
    const deps = makeDeps(home);
    deps.state.currentVersion = "v1";
    deps.state.appliedHash = "h1";
    // Write a sentinel file first; a no-op apply must not clobber it.
    writeFileSync(join(home, "sentinel"), "kept");
    const state: StateEvent = {
      version: "v2",
      hash: "h1",
      contributions: [
        {
          kind: "file",
          path: "sentinel",
          content: "would-overwrite",
          mergeMode: "overwrite",
        },
      ],
    };
    const result = await applyState(state, deps, () => {});
    expect(result.ok).toBe(true);
    expect(readFileSync(join(home, "sentinel"), "utf8")).toBe("kept");
  });
});

describe("runtime-channel service deliverSignal", () => {
  it("drops a signal whose ttl has elapsed", async () => {
    const home = mkdtempSync(join(tmpdir(), "runtime-channel-"));
    const deps = makeDeps(home);
    const signal: SignalEvent = {
      id: "s-1",
      action: "schedule.cron",
      payload: {},
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    };
    const result = await deliverSignal(signal, deps, () => {});
    expect(result.ok).toBe(true);
  });

  it("returns MissingCapability when no driver claims the action", async () => {
    const home = mkdtempSync(join(tmpdir(), "runtime-channel-"));
    const deps = makeDeps(home);
    const signal: SignalEvent = {
      id: "s-1",
      action: "unknown.action",
      payload: {},
      expiresAt: new Date(Date.now() + 5_000).toISOString(),
    };
    const result = await deliverSignal(signal, deps, () => {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("MissingCapability");
    }
  });
});
