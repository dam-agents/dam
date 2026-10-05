// TEST_OVERVIEW: the runtime's applied-state record holds only while the env file it applied is on the disk, so a home restored without that file asks the api-server for the whole desired state again.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileDocumentStoreBackend } from "../../core/document-store.js";
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
    createStateStore(
      createFileDocumentStoreBackend(home),
      () => envReady,
    ).read();

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
});
