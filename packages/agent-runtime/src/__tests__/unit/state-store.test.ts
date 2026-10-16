// TEST_OVERVIEW: the runtime's applied-state record holds only while the env file it applied is on the disk and was written the way this runtime reads it, so a home restored without that file, or with one an older runtime wrote, asks the api-server for the whole desired state again.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileDocumentStoreBackend } from "../../core/document-store.js";
import {
  createEnvStateStore,
  staleEnvReason,
} from "../../modules/runtime-channel/infrastructure/env-state-store.js";
import { createStateStore } from "../../modules/runtime-channel/state-store.js";

describe("runtime-channel state store", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "state-store-"));
    mkdirSync(join(home, ".platform"), { recursive: true });
    createStateStore(createFileDocumentStoreBackend(home)).write({
      lastAppliedVersion: 7,
      lastAppliedHash: "abc",
      eventRuns: { "sched-1": 100 },
    });
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const reopen = (envReady: boolean) =>
    createStateStore(createFileDocumentStoreBackend(home), {
      envReady: () => envReady,
    }).read();

  // TEST_SCENARIO: a runtime migration carries the state file but not the env file; reporting the old version in hello would get no push, and the harness would start with no provider.
  it("forgets the applied version when the env file is missing, keeping event runs", () => {
    expect(reopen(false)).toEqual({
      lastAppliedVersion: 0,
      lastAppliedHash: null,
      eventRuns: { "sched-1": 100 },
    });
  });

  // TEST_SCENARIO: an ordinary restart keeps its env file, so the applied version stands and hello asks only for what is newer.
  it("keeps the applied version while the env file is there", () => {
    expect(reopen(true)).toEqual({
      lastAppliedVersion: 7,
      lastAppliedHash: "abc",
      eventRuns: { "sched-1": 100 },
    });
  });

  const reopenWithEnv = (template: string | undefined) => {
    writeFileSync(
      join(home, ".platform", "runtime-env.json"),
      JSON.stringify({
        env: {},
        providers: [
          { id: "conn-1", ...(template && { template }), env: { K: "v" } },
        ],
        harnesses: [],
      }),
    );
    const env = createEnvStateStore(home, "claude-code");
    return createStateStore(createFileDocumentStoreBackend(home), {
      envReady: env.ready,
      envStale: () => staleEnvReason(env.state()),
    }).read();
  };

  // TEST_SCENARIO: an image update moves an agent from a runtime that wrote its provider env without templates to one that reads them; the api-server's state is unchanged, so only forgetting the applied version gets the templates written, or every provider reads as unsupported.
  it("forgets the applied version when an older runtime wrote the provider env", () => {
    expect(reopenWithEnv(undefined).lastAppliedVersion).toBe(0);
  });

  // TEST_SCENARIO: an env file this runtime wrote carries each provider's template, so a restart keeps the applied version.
  it("keeps the applied version when the provider env carries its templates", () => {
    expect(reopenWithEnv("ibm-litellm").lastAppliedVersion).toBe(7);
  });
});
