import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { LocalSkill, LocalSkillFile, Result, SkillsDomainError } from "agent-runtime-api";
import { err, ok } from "agent-runtime-api";
import { parseFrontmatter } from "../domain/frontmatter.js";
import type { SkillName } from "../domain/skill-name.js";
import type { SkillPath } from "../domain/skill-path.js";

const FRONTMATTER_READ_BYTES = 8 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SKILL_BYTES = 5 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 60_000;

export interface LocalSkillRepository {
  /** First-wins listing across skillPaths, dot-prefixed entries skipped,
   *  frontmatter parsed via the 8 KB fast-path. */
  listLocal: (skillPaths: SkillPath[]) => Promise<LocalSkill[]>;
  /** Read every file in a skill's directory, enforcing the per-file and
   *  per-skill caps. Errors with `SkillNotFound` when no skillPath contains
   *  the named skill, `PayloadTooLarge` on cap breach. */
  readLocal: (
    name: SkillName,
    skillPaths: SkillPath[],
  ) => Promise<Result<{ files: LocalSkillFile[] }, SkillsDomainError>>;
  /** Mirror `srcDir`'s contents into `<skillPath>/<name>/` for every path,
   *  overwriting any prior installation. Returns the deterministic content
   *  hash of the first installed dir (all targets get identical contents). */
  writeFromDir: (
    name: SkillName,
    skillPaths: SkillPath[],
    srcDir: string,
  ) => Promise<{ contentHash: string }>;
  /** Remove `<skillPath>/<name>/` from every path. */
  remove: (name: SkillName, skillPaths: SkillPath[]) => Promise<void>;
  /** Allocate a tmpdir, run `fn` against it, then unconditionally clean up. */
  withTempDir: <T>(prefix: string, fn: (dir: string) => Promise<T>) => Promise<T>;
  /** Untar a tarball buffer into `dest`, stripping the top-level wrapper
   *  directory that GitHub tarballs add. Used by both scan (no strip) and
   *  install (strip 1). */
  extractTarball: (
    bytes: Uint8Array,
    dest: string,
    opts: { stripComponents?: number },
  ) => Promise<void>;
  /** Walk a freshly-cloned/extracted repo and return every directory
   *  (relative to `repoDir`) that contains a SKILL.md. Search order:
   *  `skills/*` first, fall back to top-level `*`. */
  findSkillDirsInClone: (repoDir: string) => Promise<string[]>;
  /** Resolve the directory inside a clone where the named skill lives.
   *  Tries `skills/<name>/` first, then `<name>/`. */
  resolveSkillDirInClone: (
    repoDir: string,
    name: SkillName,
  ) => Promise<Result<string, SkillsDomainError>>;
  /** Read SKILL.md frontmatter for a directory inside a clone. */
  readSkillManifest: (absDir: string) => Promise<{ name?: string; description?: string }>;
  /** Deterministic SHA-256 over a skill directory's contents. */
  hashSkillDir: (absDir: string) => Promise<string>;
}

export function createLocalSkillRepository(): LocalSkillRepository {
  return {
    listLocal: list,
    readLocal: read,
    writeFromDir: write,
    remove,
    withTempDir,
    extractTarball,
    findSkillDirsInClone,
    resolveSkillDirInClone,
    readSkillManifest,
    hashSkillDir,
  };
}

async function list(skillPaths: SkillPath[]): Promise<LocalSkill[]> {
  const seen = new Set<string>();
  const out: LocalSkill[] = [];

  for (const skillPath of skillPaths) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(skillPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (ent.name.startsWith(".")) continue;
      if (seen.has(ent.name)) continue;

      const skillMd = path.join(skillPath, ent.name, "SKILL.md");
      let fd: import("node:fs/promises").FileHandle;
      try {
        fd = await fs.open(skillMd, "r");
      } catch {
        continue;
      }
      try {
        const buf = Buffer.alloc(FRONTMATTER_READ_BYTES);
        const { bytesRead } = await fd.read(buf, 0, FRONTMATTER_READ_BYTES, 0);
        const fm = parseFrontmatter(buf.subarray(0, bytesRead).toString("utf8"));
        seen.add(ent.name);
        out.push({
          name: fm.name?.trim() || ent.name,
          description: fm.description?.trim() || "",
          skillPath,
        });
      } finally {
        await fd.close();
      }
    }
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function read(
  name: SkillName,
  skillPaths: SkillPath[],
): Promise<Result<{ files: LocalSkillFile[] }, SkillsDomainError>> {
  const root = await findLocalSkillDir(name, skillPaths);
  if (!root) return err({ kind: "SkillNotFound", name, skillPaths });

  const absFiles = (await walkFiles(root)).sort();
  const out: LocalSkillFile[] = [];
  let total = 0;

  for (const abs of absFiles) {
    const stat = await fs.stat(abs);
    if (stat.size > MAX_FILE_BYTES) {
      return err({
        kind: "PayloadTooLarge",
        detail: `${path.relative(root, abs)} is ${stat.size} bytes (max ${MAX_FILE_BYTES})`,
      });
    }
    total += stat.size;
    if (total > MAX_SKILL_BYTES) {
      return err({ kind: "PayloadTooLarge", detail: `skill exceeds ${MAX_SKILL_BYTES} bytes total` });
    }
    const buf = await fs.readFile(abs);
    const relPath = path.relative(root, abs);
    if (hasNullBytes(buf)) {
      out.push({ relPath, content: buf.toString("base64"), base64: true });
    } else {
      out.push({ relPath, content: buf.toString("utf8") });
    }
  }

  return ok({ files: out });
}

async function write(
  name: SkillName,
  skillPaths: SkillPath[],
  srcDir: string,
): Promise<{ contentHash: string }> {
  for (const targetRoot of skillPaths) {
    await fs.mkdir(targetRoot, { recursive: true });
    const dst = path.join(targetRoot, name);
    await fs.rm(dst, { recursive: true, force: true });
    await fs.cp(srcDir, dst, { recursive: true });
    try {
      await assertNoSymlinks(dst);
    } catch (e) {
      await fs.rm(dst, { recursive: true, force: true });
      throw e;
    }
  }
  // All install targets receive the same contents, so hashing the first is
  // sufficient. Computed from the installed dir (rather than from the source
  // tmpdir) so the hash reflects what actually landed on the pod.
  const firstTarget = path.join(skillPaths[0], name);
  const contentHash = await hashSkillDir(firstTarget);
  return { contentHash };
}

async function remove(name: SkillName, skillPaths: SkillPath[]): Promise<void> {
  for (const targetRoot of skillPaths) {
    const dst = path.join(targetRoot, name);
    await fs.rm(dst, { recursive: true, force: true });
  }
}

async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await fn(tmp);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

async function extractTarball(
  bytes: Uint8Array,
  dest: string,
  opts: { stripComponents?: number },
): Promise<void> {
  const tgz = path.join(dest, "_src.tgz");
  await fs.writeFile(tgz, bytes);
  const listing = await runProc("tar", ["-tzf", tgz]);
  for (const line of listing.split("\n")) {
    const entry = line.trim();
    if (!entry) continue;
    assertSafeTarEntry(entry);
  }
  const args = ["-xzf", tgz, "--no-same-owner"];
  if (opts.stripComponents !== undefined) args.push(`--strip-components=${opts.stripComponents}`);
  args.push("-C", dest);
  await runProc("tar", args);
  await fs.rm(tgz);
}

function assertSafeTarEntry(entry: string): void {
  if (entry.startsWith("/")) {
    throw new Error(`tarball rejected: absolute path ${entry}`);
  }
  for (const segment of entry.split("/")) {
    if (segment === "..") {
      throw new Error(`tarball rejected: path traversal in ${entry}`);
    }
  }
}

async function findSkillDirsInClone(repoDir: string): Promise<string[]> {
  const found: string[] = [];
  const candidates = [path.join(repoDir, "skills"), repoDir];
  for (const root of candidates) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
      const dir = path.join(root, ent.name);
      try {
        await fs.access(path.join(dir, "SKILL.md"));
        found.push(path.relative(repoDir, dir));
      } catch {}
    }
    if (found.length > 0) return found;
  }
  return found;
}

async function resolveSkillDirInClone(
  repoDir: string,
  name: SkillName,
): Promise<Result<string, SkillsDomainError>> {
  for (const candidate of [path.join(repoDir, "skills", name), path.join(repoDir, name)]) {
    try {
      await fs.access(path.join(candidate, "SKILL.md"));
      return ok(candidate);
    } catch {}
  }
  return err({ kind: "SkillNotFoundInSource", source: repoDir, name });
}

async function readSkillManifest(absDir: string): Promise<{ name?: string; description?: string }> {
  const content = await fs.readFile(path.join(absDir, "SKILL.md"), "utf8");
  return parseFrontmatter(content);
}

/**
 * Deterministic SHA-256 of a skill directory's contents — hashes every file
 * under the dir in sorted-path order, mixing the relative path and body
 * bytes. Used as the drift signal: changes iff the skill's files change,
 * completely independent of git commit history. Matches api-server's
 * computeContentHash.
 */
async function hashSkillDir(absDir: string): Promise<string> {
  const files = (await walkFiles(absDir)).sort();
  const h = createHash("sha256");
  for (const abs of files) {
    const rel = path.relative(absDir, abs);
    h.update(rel);
    h.update(Buffer.from([0]));
    h.update(await fs.readFile(abs));
    h.update(Buffer.from([0]));
  }
  return h.digest("hex");
}

async function findLocalSkillDir(name: SkillName, skillPaths: SkillPath[]): Promise<string | null> {
  for (const base of skillPaths) {
    const candidate = path.join(base, name);
    try {
      await fs.access(path.join(candidate, "SKILL.md"));
      return candidate;
    } catch {}
  }
  return null;
}

async function assertNoSymlinks(root: string): Promise<void> {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    const entries = await fs.readdir(dir);
    for (const entryName of entries) {
      const full = path.join(dir, entryName);
      const st = await fs.lstat(full);
      if (st.isSymbolicLink()) {
        throw new Error(`skill rejected: symlink at ${path.relative(root, full)}`);
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else if (!st.isFile()) {
        throw new Error(`skill rejected: non-regular file at ${path.relative(root, full)}`);
      }
    }
  }
}

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function rec(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name.startsWith(".")) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await rec(full);
      } else if (ent.isFile()) {
        out.push(full);
      }
    }
  }
  await rec(root);
  return out;
}

function hasNullBytes(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8192);
  for (let i = 0; i < len; i++) if (buf[i] === 0) return true;
  return false;
}

async function runProc(cmd: string, args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`${cmd} ${args.join(" ")} timed out after ${COMMAND_TIMEOUT_MS}ms`));
    }, COMMAND_TIMEOUT_MS);
    proc.stdout?.on("data", (c: Buffer) => stdoutChunks.push(c));
    proc.stderr?.on("data", (c: Buffer) => stderrChunks.push(c));
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks).toString("utf8"));
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      reject(new Error(`${cmd} ${args.join(" ")} exited ${code}${stderr ? `: ${stderr}` : ""}`));
    });
  });
}
