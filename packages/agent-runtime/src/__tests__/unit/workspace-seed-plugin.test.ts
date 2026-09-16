import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import type { EventContext } from "agent-runtime-api";
import {
  createWorkspaceSeedPlugin,
  type CloneFn,
  type FetchAtShaFn,
} from "../../modules/runtime-channel/drivers/workspace-seed-plugin.js";

const URL = "https://github.com/dam-agents/google-workspace.git";

const ctx: EventContext = {
  eventId: "evt-1:1",
  agentHome: "",
  pluginStateDir: "",
  log: () => {},
};

function setup(clone: CloneFn, fetchAtSha?: FetchAtShaFn) {
  const workDir = join(mkdtempSync(join(tmpdir(), "seed-ws-")), "work");
  const seed = createWorkspaceSeedPlugin({
    workDir,
    clone,
    ...(fetchAtSha ? { fetchAtSha } : {}),
    log: () => {},
  }).bindEvent!("workspace-seed", { impl: "workspace-seed" });
  return { seed: (payload: unknown) => seed(payload, ctx), workDir };
}

describe("workspace-seed plugin", () => {
  it("clones into an empty work dir", async () => {
    const clone = vi.fn<CloneFn>(async () => ({ ok: true, value: undefined }));
    const { seed, workDir } = setup(clone);
    await seed({ url: URL });
    expect(clone).toHaveBeenCalledWith(URL, workDir, undefined);
  });

  it("passes the ref (branch/tag) through to the clone", async () => {
    const clone = vi.fn<CloneFn>(async () => ({ ok: true, value: undefined }));
    const { seed, workDir } = setup(clone);
    await seed({ url: URL, ref: "develop" });
    expect(clone).toHaveBeenCalledWith(URL, workDir, "develop");
  });

  it("fetches a full commit sha directly instead of cloning a branch", async () => {
    const clone = vi.fn<CloneFn>(async () => ({ ok: true, value: undefined }));
    const fetchAtSha = vi.fn<FetchAtShaFn>(async () => ({
      ok: true,
      value: undefined,
    }));
    const { seed, workDir } = setup(clone, fetchAtSha);
    const sha = "a".repeat(40);
    await seed({ url: URL, ref: sha });
    expect(fetchAtSha).toHaveBeenCalledWith(URL, sha, workDir);
    expect(clone).not.toHaveBeenCalled();
  });

  it("skips when the work dir already holds a repo (.git present)", async () => {
    const clone = vi.fn<CloneFn>(async () => ({ ok: true, value: undefined }));
    const { seed, workDir } = setup(clone);
    mkdirSync(join(workDir, ".git"), { recursive: true });
    await seed({ url: URL });
    expect(clone).not.toHaveBeenCalled();
  });

  it("throws on a non-empty work dir without a .git (dirty)", async () => {
    const clone = vi.fn<CloneFn>(async () => ({ ok: true, value: undefined }));
    const { seed, workDir } = setup(clone);
    mkdirSync(workDir, { recursive: true });
    writeFileSync(join(workDir, "notes.txt"), "user work");
    await expect(seed({ url: URL })).rejects.toThrow(
      /non-empty work directory/,
    );
    expect(clone).not.toHaveBeenCalled();
  });

  it("surfaces a clone failure as a throw", async () => {
    const clone = vi.fn<CloneFn>(async () => ({
      ok: false,
      error: { kind: "SourceFetchFailed", source: URL, detail: "boom" },
    }));
    const { seed } = setup(clone);
    await expect(seed({ url: URL })).rejects.toThrow(/boom/);
  });
});
