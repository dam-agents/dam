import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGunzip } from "node:zlib";
import { extract as tarExtract } from "tar-stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createBundleBuilder,
  resolveArgs,
} from "../modules/import/infrastructure/bundle-builder.js";

interface Entry {
  name: string;
  type: string;
  body: string;
}

async function readBundle(tarGzPath: string): Promise<Entry[]> {
  const entries: Entry[] = [];
  const extract = tarExtract();
  extract.on("entry", (header, stream, next) => {
    let body = "";
    stream.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf-8");
    });
    stream.on("end", () => {
      entries.push({
        name: header.name,
        type: header.type ?? "unknown",
        body,
      });
      next();
    });
    stream.resume();
  });
  await new Promise<void>((resolve, reject) => {
    extract.on("finish", () => resolve());
    extract.on("error", reject);
    createReadStream(tarGzPath)
      .on("error", reject)
      .pipe(createGunzip())
      .pipe(extract);
  });
  return entries;
}

describe("resolveArgs", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "cli-bundle-args-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("rejects a top-level path whose basename is in the excluded set", async () => {
    const dir = join(root, "node_modules");
    await mkdir(dir);

    const r = await resolveArgs([dir]);

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("bundle-failed");
      expect(r.error.reason).toContain("node_modules");
    }
  });

  it("rejects duplicate top-level basenames from different parents", async () => {
    const a = join(root, "a");
    const b = join(root, "b");
    await mkdir(a);
    await mkdir(b);
    await writeFile(join(a, "same"), "x");
    await writeFile(join(b, "same"), "y");

    const r = await resolveArgs([join(a, "same"), join(b, "same")]);

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.reason).toContain("duplicate");
      expect(r.error.reason).toContain("same");
    }
  });

  it("rejects a symlinked top-level arg", async () => {
    const target = join(root, "target.txt");
    const link = join(root, "link.txt");
    await writeFile(target, "x");
    await symlink(target, link);

    const r = await resolveArgs([link]);

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.reason).toContain("symlink");
    }
  });

  it("rejects a nonexistent top-level path", async () => {
    const r = await resolveArgs([join(root, "missing")]);

    expect(r.ok).toBe(false);
  });

  it("classifies file and directory args and preserves order", async () => {
    const f = join(root, "file.txt");
    const d = join(root, "dir");
    await writeFile(f, "x");
    await mkdir(d);

    const r = await resolveArgs([f, d]);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toHaveLength(2);
      expect(r.value[0]).toMatchObject({ kind: "file", name: "file.txt" });
      expect(r.value[1]).toMatchObject({ kind: "dir", name: "dir" });
    }
  });
});

describe("createBundleBuilder().pack", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "cli-bundle-pack-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  // Single fixture exercises every traversal-correctness invariant:
  // recursion, dir-exclusion (node_modules, __pycache__), file-exclusion
  // (.DS_Store), symlink skipping, file body streaming, and cleanup.
  it("packs nested trees, excludes excluded names and symlinks, cleanup removes tmp", async () => {
    const dir = join(root, "proj");
    await mkdir(join(dir, "nested"), { recursive: true });
    await mkdir(join(dir, "node_modules", "evil"), { recursive: true });
    await mkdir(join(dir, "nested", "__pycache__"), { recursive: true });
    await writeFile(join(dir, "top.txt"), "top");
    await writeFile(join(dir, ".DS_Store"), "junk");
    await writeFile(join(dir, "nested", "leaf.txt"), "leaf");
    await writeFile(join(dir, "nested", ".DS_Store"), "junk");
    await writeFile(join(dir, "node_modules", "evil", "x.txt"), "x");
    await writeFile(join(dir, "nested", "__pycache__", "z.pyc"), "z");
    const external = join(root, "external.txt");
    await writeFile(external, "external");
    await symlink(external, join(dir, "link.txt"));

    const r = await resolveArgs([dir]);
    if (!r.ok) throw new Error(r.error.reason);
    const packed = await createBundleBuilder().pack(r.value);
    if (!packed.ok) throw new Error(packed.error.reason);
    const tmpPath = packed.value.tmpPath;

    const entries = await readBundle(tmpPath);
    expect(entries.map((e) => e.name).sort()).toEqual([
      "proj/",
      "proj/nested/",
      "proj/nested/leaf.txt",
      "proj/top.txt",
    ]);
    expect(entries.find((e) => e.name === "proj/nested/leaf.txt")?.body).toBe(
      "leaf",
    );
    expect(packed.value.byteLength).toBeGreaterThan(0);

    await packed.value.cleanup();
    await expect(stat(tmpPath)).rejects.toThrow();
  });
});
