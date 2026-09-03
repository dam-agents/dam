import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { planShare } from "../walker.js";

/**
 * TEST_OVERVIEW: the publish walk over a real tmpdir workspace — root
 * resolution, dotfile and binary exclusion, symlink-cycle and depth guards,
 * cap failures as typed codes, and workspace-relative path emission (the
 * manifest path contract consumers see).
 */

const caps = {
  perFileMaxBytes: 1024,
  totalMaxBytes: 10 * 1024,
  maxFiles: 10,
  maxWalkDepth: 4,
};

let workDir = "";
let outsideDir = "";

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "kb-publish-walker-"));
  await mkdir(join(workDir, "wiki/guides"), { recursive: true });
  await mkdir(join(workDir, "wiki/.hidden"), { recursive: true });
  await writeFile(join(workDir, "wiki/index.md"), "# hello world\n");
  await writeFile(join(workDir, "wiki/guides/deep.md"), "deep content\n");
  await writeFile(join(workDir, "wiki/.dotfile.md"), "hidden\n");
  await writeFile(join(workDir, "wiki/.hidden/secret.md"), "hidden\n");
  await writeFile(join(workDir, "wiki/binary.md"), Buffer.from([104, 0, 105]));
  await writeFile(join(workDir, "wiki/big.md"), "x".repeat(2048));

  await mkdir(join(workDir, "loop"), { recursive: true });
  await writeFile(join(workDir, "loop/file.md"), "looped\n");
  await symlink(join(workDir, "loop"), join(workDir, "loop/self"));

  await mkdir(join(workDir, "deep/d1/d2/d3/d4/d5"), { recursive: true });
  await writeFile(join(workDir, "deep/d1/d2/d3/d4/d5/leaf.md"), "leaf\n");

  await mkdir(join(workDir, "crowd"), { recursive: true });
  for (let i = 0; i < 12; i += 1) {
    await writeFile(join(workDir, `crowd/f${i}.md`), `file ${i}\n`);
  }

  await mkdir(join(workDir, "secret"), { recursive: true });
  await writeFile(join(workDir, "secret/credentials.md"), "s3cr3t\n");
  await writeFile(join(workDir, "secret/id_rsa.md"), "key material\n");
  await mkdir(join(workDir, "linked/sub"), { recursive: true });
  await writeFile(join(workDir, "linked/real.md"), "inside\n");
  await symlink(
    join(workDir, "secret/credentials.md"),
    join(workDir, "linked/leak.md"),
  );
  await symlink(join(workDir, "secret"), join(workDir, "linked/sub/outdir"));
  await symlink(
    join(workDir, "linked/real.md"),
    join(workDir, "linked/alias.md"),
  );

  outsideDir = await mkdtemp(join(tmpdir(), "kb-publish-outside-"));
  await writeFile(join(outsideDir, "creds.md"), "outside\n");
  await symlink(outsideDir, join(workDir, "escape"));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
  await rm(outsideDir, { recursive: true, force: true });
});

describe("planShare", () => {
  // TEST_SCENARIO: a normal root yields sorted workspace-relative paths with sizes and content hashes, excluding dot entries, binaries, and over-cap files silently.
  it("plans a root with the documented exclusions", async () => {
    const result = await planShare({ workDir, roots: ["wiki"], caps });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.files.map((f) => f.path)).toEqual([
      "wiki/guides/deep.md",
      "wiki/index.md",
    ]);
    const index = result.value.files.find((f) => f.path === "wiki/index.md")!;
    expect(index.sizeBytes).toBe(Buffer.byteLength("# hello world\n"));
    expect(index.contentHash).toBe(
      createHash("sha256").update("# hello world\n").digest("hex"),
    );
  });

  // TEST_SCENARIO: a missing root is the typed root-missing failure carrying the root name.
  it("fails typed on a missing root", async () => {
    const result = await planShare({ workDir, roots: ["nope"], caps });
    expect(result).toEqual({
      ok: false,
      error: { code: "root-missing", root: "nope" },
    });
  });

  // TEST_SCENARIO: a symlink cycle inside a root terminates via the realpath visited-set instead of walking forever.
  it("survives a symlink cycle", async () => {
    const result = await planShare({ workDir, roots: ["loop"], caps });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.files.map((f) => f.path)).toEqual(["loop/file.md"]);
  });

  // TEST_SCENARIO: symlinks pointing outside the share root — a file link and a directory link — are excluded from the plan, while a symlink resolving inside the root is still published.
  it("confines the plan to the share root across symlinks", async () => {
    const result = await planShare({ workDir, roots: ["linked"], caps });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.files.map((f) => f.path)).toEqual([
      "linked/alias.md",
      "linked/real.md",
    ]);
  });

  // TEST_SCENARIO: a share root that is itself a symlink resolving outside the workspace is rejected as root-missing instead of publishing the link target.
  it("rejects a root that is a symlink out of the workspace", async () => {
    const result = await planShare({ workDir, roots: ["escape"], caps });
    expect(result).toEqual({
      ok: false,
      error: { code: "root-missing", root: "escape" },
    });
  });

  // TEST_SCENARIO: nesting past maxWalkDepth is the typed too-deep failure.
  it("fails typed past the depth cap", async () => {
    const result = await planShare({ workDir, roots: ["deep"], caps });
    expect(result).toEqual({ ok: false, error: { code: "too-deep" } });
  });

  // TEST_SCENARIO: more candidate files than maxFiles is the typed too-many-files failure.
  it("fails typed past the file-count cap", async () => {
    const result = await planShare({ workDir, roots: ["crowd"], caps });
    expect(result).toEqual({ ok: false, error: { code: "too-many-files" } });
  });

  // TEST_SCENARIO: included bytes past totalMaxBytes is the typed total-too-large failure.
  it("fails typed past the total-bytes cap", async () => {
    const result = await planShare({
      workDir,
      roots: ["crowd"],
      caps: { ...caps, maxFiles: 100, totalMaxBytes: 16 },
    });
    expect(result).toEqual({ ok: false, error: { code: "total-too-large" } });
  });
});
