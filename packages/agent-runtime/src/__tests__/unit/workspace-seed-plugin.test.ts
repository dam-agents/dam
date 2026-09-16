// TEST_OVERVIEW: the seed plugin fills the work directory once and never lies about it: completion is its own sentinel, not a `.git` it may not have made; a commit is fetched in place, a branch cloned; a repository it did not start is refused rather than adopted; and a failure surfaces as a throw for the loop to report.
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { EventContext } from "agent-runtime-api";
import { describe, expect, it, vi } from "vitest";

import {
  createWorkspaceSeedPlugin,
  type CloneFn,
  type FetchIntoFn,
} from "../../modules/runtime-channel/drivers/workspace-seed-plugin.js";

const URL = "https://github.com/dam-agents/google-workspace.git";
const SHA = "a".repeat(40);

const okClone = () =>
  vi.fn<CloneFn>(async () => ({ ok: true, value: undefined }));
const okFetch = () =>
  vi.fn<FetchIntoFn>(async () => ({ ok: true, value: undefined }));

function setup(clone: CloneFn, fetchInto: FetchIntoFn) {
  const root = mkdtempSync(join(tmpdir(), "seed-ws-"));
  const workDir = join(root, "work");
  const stateDir = join(root, "state");
  const ctx: EventContext = {
    eventId: "evt-1:1",
    agentHome: root,
    pluginStateDir: stateDir,
    log: () => {},
  };
  const seed = createWorkspaceSeedPlugin({
    workDir,
    clone,
    fetchInto,
    log: () => {},
  }).bindEvent!("workspace-seed", { impl: "workspace-seed" });
  return { seed: (payload: unknown) => seed(payload, ctx), workDir, stateDir };
}

describe("workspace-seed plugin", () => {
  it("clones a branch into an empty work dir and marks completion", async () => {
    const clone = okClone();
    const fetchInto = okFetch();
    const { seed, workDir, stateDir } = setup(clone, fetchInto);
    await seed({ url: URL, ref: "develop" });
    expect(clone).toHaveBeenCalledWith(URL, workDir, "develop");
    expect(fetchInto).not.toHaveBeenCalled();
    expect(existsSync(join(stateDir, "seed.done"))).toBe(true);
  });

  it("fetches a full commit sha in place instead of cloning a branch", async () => {
    const clone = okClone();
    const fetchInto = okFetch();
    const { seed, workDir } = setup(clone, fetchInto);
    await seed({ url: URL, ref: SHA });
    expect(fetchInto).toHaveBeenCalledWith(URL, workDir, SHA);
    expect(clone).not.toHaveBeenCalled();
  });

  it("skips once its own completion sentinel exists, whatever the work dir holds", async () => {
    const clone = okClone();
    const fetchInto = okFetch();
    const { seed, stateDir } = setup(clone, fetchInto);
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "seed.done"), "done");
    await seed({ url: URL });
    expect(clone).not.toHaveBeenCalled();
    expect(fetchInto).not.toHaveBeenCalled();
  });

  it("refuses a repository it did not start, instead of calling it seeded", async () => {
    const clone = okClone();
    const fetchInto = okFetch();
    const { seed, workDir } = setup(clone, fetchInto);
    mkdirSync(join(workDir, ".git"), { recursive: true });
    await expect(seed({ url: URL })).rejects.toThrow(/did not seed/);
    expect(clone).not.toHaveBeenCalled();
  });

  it("resumes its own interrupted attempt in place", async () => {
    const clone = okClone();
    const fetchInto = okFetch();
    const { seed, workDir, stateDir } = setup(clone, fetchInto);
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "seed.started"), "started");
    mkdirSync(join(workDir, ".git"), { recursive: true });
    await seed({ url: URL, ref: "develop" });
    expect(fetchInto).toHaveBeenCalledWith(URL, workDir, "develop");
    expect(clone).not.toHaveBeenCalled();
  });

  it("throws on a non-empty work dir without a .git (dirty)", async () => {
    const clone = okClone();
    const fetchInto = okFetch();
    const { seed, workDir } = setup(clone, fetchInto);
    mkdirSync(workDir, { recursive: true });
    writeFileSync(join(workDir, "notes.txt"), "user work");
    await expect(seed({ url: URL })).rejects.toThrow(
      /non-empty work directory/,
    );
    expect(clone).not.toHaveBeenCalled();
  });

  it("surfaces a clone failure as a throw and leaves no completion mark", async () => {
    const clone = vi.fn<CloneFn>(async () => ({
      ok: false,
      error: { kind: "SourceFetchFailed", source: URL, detail: "boom" },
    }));
    const { seed, stateDir } = setup(clone, okFetch());
    await expect(seed({ url: URL })).rejects.toThrow(/boom/);
    expect(existsSync(join(stateDir, "seed.done"))).toBe(false);
  });
});
