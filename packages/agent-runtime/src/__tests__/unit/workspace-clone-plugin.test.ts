import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import type { Contribution, DispatchContext } from "agent-runtime-api";
import {
  createWorkspaceClonePlugin,
  type CloneFn,
} from "../../modules/runtime-channel/drivers/workspace-clone-plugin.js";

function setup(clone: CloneFn) {
  const agentHome = mkdtempSync(join(tmpdir(), "ws-clone-"));
  const plugin = createWorkspaceClonePlugin({ clone });
  const handler = plugin.bind("workspace-git", {
    impl: "workspace-clone",
    target: "$HOME/work",
  });
  const ctx: DispatchContext = {
    agentHome,
    pluginStateDir: agentHome,
    log: () => {},
  };
  const work = join(agentHome, "work");
  const seed: Contribution = {
    kind: "workspace-git",
    sourceUrl: "https://github.com/dam-agents/google-workspace.git",
  };
  return { handler, ctx, work, seed };
}

describe("workspace-clone plugin", () => {
  it("clones into an empty work dir", async () => {
    const clone = vi.fn<CloneFn>(async () => ({ ok: true, value: undefined }));
    const { handler, ctx, work, seed } = setup(clone);
    await handler([seed], ctx);
    expect(clone).toHaveBeenCalledTimes(1);
    expect(clone).toHaveBeenCalledWith(seed.sourceUrl, work);
  });

  it("skips when the work dir already holds a repo (.git present)", async () => {
    const clone = vi.fn<CloneFn>(async () => ({ ok: true, value: undefined }));
    const { handler, ctx, work, seed } = setup(clone);
    mkdirSync(join(work, ".git"), { recursive: true });
    await handler([seed], ctx);
    expect(clone).not.toHaveBeenCalled();
  });

  it("throws when the work dir is non-empty without a .git (dirty)", async () => {
    const clone = vi.fn<CloneFn>(async () => ({ ok: true, value: undefined }));
    const { handler, ctx, work, seed } = setup(clone);
    mkdirSync(work, { recursive: true });
    writeFileSync(join(work, "notes.txt"), "user work");
    await expect(handler([seed], ctx)).rejects.toThrow(
      /non-empty work directory/,
    );
    expect(clone).not.toHaveBeenCalled();
  });

  it("surfaces a clone failure as a throw (→ DriverFailure)", async () => {
    const clone = vi.fn<CloneFn>(async () => ({
      ok: false,
      error: { kind: "SourceFetchFailed", source: "x", detail: "boom" },
    }));
    const { handler, ctx, seed } = setup(clone);
    await expect(handler([seed], ctx)).rejects.toThrow(/boom/);
  });

  it("no-ops when there is no workspace-git contribution", async () => {
    const clone = vi.fn<CloneFn>(async () => ({ ok: true, value: undefined }));
    const { handler, ctx } = setup(clone);
    await handler([], ctx);
    expect(clone).not.toHaveBeenCalled();
  });
});
