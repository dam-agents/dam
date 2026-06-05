import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import {
  createSeedWorkspace,
  type CloneFn,
} from "../../modules/runtime-channel/seed-workspace.js";

const URL = "https://github.com/dam-agents/google-workspace.git";

function setup(clone: CloneFn) {
  const workDir = join(mkdtempSync(join(tmpdir(), "seed-ws-")), "work");
  const seed = createSeedWorkspace({ workDir, clone, log: () => {} });
  return { seed, workDir };
}

describe("seed-workspace handler", () => {
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
