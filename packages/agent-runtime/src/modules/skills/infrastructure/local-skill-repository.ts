import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
  LocalSkill,
  LocalSkillFile,
  Result,
  SkillOrigin,
  SkillsDomainError,
} from "agent-runtime-api";
import { err, ok, SKILL_SOURCE_ROOTS } from "agent-runtime-api";
import { parseFrontmatter } from "../domain/frontmatter.js";
import type { SkillName } from "../domain/skill-name.js";
import { judgeOrigin } from "../domain/skill-origin.js";
import type { SkillPath } from "../domain/skill-path.js";

const FRONTMATTER_READ_BYTES = 8 * 1024;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_SKILL_BYTES = 5 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 60_000;

export interface LocalSkillRepository {
  listLocal: (
    skillPaths: SkillPath[],
    pristinePaths?: SkillPath[],
    hashNames?: ReadonlySet<string>,
  ) => Promise<LocalSkill[]>;
  readLocal: (
    name: SkillName,
    skillPaths: SkillPath[],
  ) => Promise<
    Result<{ dir: string; files: LocalSkillFile[] }, SkillsDomainError>
  >;
  resolveLocalSkillDir: (
    name: SkillName,
    skillPaths: SkillPath[],
  ) => Promise<{ absDir: string; dir: SkillName } | null>;
  writeFromDir: (
    name: SkillName,
    skillPaths: SkillPath[],
    srcDir: string,
  ) => Promise<{ contentHash: string }>;
  writeLocalSkill: (
    name: SkillName,
    skillPaths: SkillPath[],
    content: string,
  ) => Promise<void>;
  existsInAnyPath: (
    name: SkillName,
    skillPaths: SkillPath[],
  ) => Promise<boolean>;
  remove: (name: SkillName, skillPaths: SkillPath[]) => Promise<void>;
  withTempDir: <T>(
    prefix: string,
    fn: (dir: string) => Promise<T>,
  ) => Promise<T>;
  extractTarball: (
    bytes: Uint8Array,
    dest: string,
    opts: { stripComponents?: number },
  ) => Promise<void>;
  findSkillDirsInClone: (
    repoDir: string,
    subPath?: string,
  ) => Promise<string[]>;
  resolveSkillDirInClone: (
    repoDir: string,
    name: SkillName,
    subPath?: string,
  ) => Promise<Result<string, SkillsDomainError>>;
  readSkillManifest: (
    absDir: string,
  ) => Promise<{ name?: string; description?: string }>;
  hashSkillDir: (absDir: string) => Promise<string>;
}

export function createLocalSkillRepository(): LocalSkillRepository {
  const pristineHashes = new Map<string, Promise<string | null>>();
  const contentHashCache = new Map<string, CachedContentHash>();
  return {
    listLocal: (skillPaths, pristinePaths, hashNames) =>
      list(
        skillPaths,
        pristinePaths,
        pristineHashes,
        hashNames,
        contentHashCache,
      ),
    readLocal: read,
    resolveLocalSkillDir,
    writeFromDir: write,
    writeLocalSkill,
    existsInAnyPath,
    remove,
    withTempDir,
    extractTarball,
    findSkillDirsInClone,
    resolveSkillDirInClone,
    readSkillManifest,
    hashSkillDir,
  };
}

interface LocalSkillEntry extends LocalSkill {
  dir: SkillName;
}

async function listEntries(
  skillPaths: SkillPath[],
): Promise<LocalSkillEntry[]> {
  const seen = new Set<string>();
  const out: LocalSkillEntry[] = [];

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
        const fm = parseFrontmatter(
          buf.subarray(0, bytesRead).toString("utf8"),
        );
        seen.add(ent.name);
        out.push({
          name: fm.name?.trim() || ent.name,
          description: fm.description?.trim() || "",
          skillPath,
          dir: ent.name as SkillName,
        });
      } finally {
        await fd.close();
      }
    }
  }

  return out;
}

async function list(
  skillPaths: SkillPath[],
  pristinePaths: SkillPath[] | undefined,
  pristineHashes: Map<string, Promise<string | null>>,
  hashNames: ReadonlySet<string> | undefined,
  contentHashCache: Map<string, CachedContentHash>,
): Promise<LocalSkill[]> {
  const out: LocalSkill[] = [];
  for (const { dir, name, description, skillPath } of await listEntries(
    skillPaths,
  )) {
    const contentHash = hashNames?.has(name)
      ? await hashSkillDirCached(path.join(skillPath, dir), contentHashCache)
      : null;
    out.push({
      name,
      description,
      skillPath,
      ...(pristinePaths !== undefined
        ? {
            origin: await classifyOrigin(
              dir,
              path.join(skillPath, dir),
              pristinePaths,
              pristineHashes,
              contentHashCache,
            ),
          }
        : {}),
      ...(contentHash !== null ? { contentHash } : {}),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function resolveLocalSkillDir(
  name: SkillName,
  skillPaths: SkillPath[],
): Promise<{ absDir: string; dir: SkillName } | null> {
  for (const base of skillPaths) {
    const absDir = path.join(base, name);
    try {
      await fs.access(path.join(absDir, "SKILL.md"));
      return { absDir, dir: name };
    } catch {}
  }
  for (const ent of await listEntries(skillPaths)) {
    if (ent.name === name) {
      return { absDir: path.join(ent.skillPath, ent.dir), dir: ent.dir };
    }
  }
  return null;
}

async function classifyOrigin(
  dirName: string,
  localDir: string,
  pristinePaths: SkillPath[],
  pristineHashes: Map<string, Promise<string | null>>,
  contentHashCache: Map<string, CachedContentHash>,
): Promise<SkillOrigin> {
  const pristineHash = await firstPristineHash(
    dirName,
    pristinePaths,
    pristineHashes,
  );
  const localHash =
    pristineHash === null
      ? null
      : await hashSkillDirCached(localDir, contentHashCache);
  return judgeOrigin(localHash, pristineHash);
}

async function firstPristineHash(
  dirName: string,
  pristinePaths: SkillPath[],
  pristineHashes: Map<string, Promise<string | null>>,
): Promise<string | null> {
  for (const base of pristinePaths) {
    const pristineDir = path.join(base, dirName);
    let hashPromise = pristineHashes.get(pristineDir);
    if (!hashPromise) {
      hashPromise = hashSkillDirIfPresent(pristineDir);
      pristineHashes.set(pristineDir, hashPromise);
    }
    const hash = await hashPromise;
    if (hash !== null) return hash;
  }
  return null;
}

interface CachedContentHash {
  fingerprint: string;
  hash: string;
}

async function statFingerprint(absDir: string): Promise<string | null> {
  try {
    const files = (await walkFiles(absDir)).sort();
    const parts: string[] = [];
    for (const abs of files) {
      const st = await fs.stat(abs);
      parts.push(`${path.relative(absDir, abs)}\0${st.size}\0${st.mtimeMs}`);
    }
    return parts.join("\n");
  } catch {
    return null;
  }
}

async function hashSkillDirCached(
  absDir: string,
  cache: Map<string, CachedContentHash>,
): Promise<string | null> {
  const fingerprint = await statFingerprint(absDir);
  if (fingerprint === null) {
    cache.delete(absDir);
    return hashSkillDirIfPresent(absDir);
  }
  const cached = cache.get(absDir);
  if (cached && cached.fingerprint === fingerprint) return cached.hash;
  const hash = await hashSkillDirIfPresent(absDir);
  if (hash === null) cache.delete(absDir);
  else cache.set(absDir, { fingerprint, hash });
  return hash;
}

async function hashSkillDirIfPresent(absDir: string): Promise<string | null> {
  try {
    await fs.access(path.join(absDir, "SKILL.md"));
    return await hashSkillDir(absDir);
  } catch {
    return null;
  }
}

async function read(
  name: SkillName,
  skillPaths: SkillPath[],
): Promise<
  Result<{ dir: string; files: LocalSkillFile[] }, SkillsDomainError>
> {
  const resolved = await resolveLocalSkillDir(name, skillPaths);
  if (!resolved) return err({ kind: "SkillNotFound", name, skillPaths });
  const root = resolved.absDir;

  const absFiles = (await walkFiles(root)).sort();
  const out: LocalSkillFile[] = [];
  let total = 0;

  for (const abs of absFiles) {
    const fh = await fs.open(abs, "r");
    try {
      const stat = await fh.stat();
      if (stat.size > MAX_FILE_BYTES) {
        return err({
          kind: "PayloadTooLarge",
          detail: `${path.relative(root, abs)} is ${stat.size} bytes (max ${MAX_FILE_BYTES})`,
        });
      }
      total += stat.size;
      if (total > MAX_SKILL_BYTES) {
        return err({
          kind: "PayloadTooLarge",
          detail: `skill exceeds ${MAX_SKILL_BYTES} bytes total`,
        });
      }
      const buf = await fh.readFile();
      const relPath = path.relative(root, abs);
      if (hasNullBytes(buf)) {
        out.push({ relPath, content: buf.toString("base64"), base64: true });
      } else {
        out.push({ relPath, content: buf.toString("utf8") });
      }
    } finally {
      await fh.close();
    }
  }

  return ok({ dir: resolved.dir, files: out });
}

async function write(
  name: SkillName,
  skillPaths: SkillPath[],
  srcDir: string,
): Promise<{ contentHash: string }> {
  for (const targetRoot of skillPaths) {
    await fs.mkdir(targetRoot, { recursive: true });
    const dst = path.join(targetRoot, name);
    const staged = path.join(targetRoot, `.${name}.staging`);
    const previous = path.join(targetRoot, `.${name}.previous`);
    let published = false;
    try {
      await fs.rm(staged, { recursive: true, force: true });
      await fs.rm(previous, { recursive: true, force: true });
      await fs.cp(srcDir, staged, { recursive: true });
      await assertNoSymlinks(staged);
      await fs.rename(dst, previous).catch(ignoreMissing);
      await fs.rename(staged, dst);
      published = true;
    } finally {
      await fs.rm(staged, { recursive: true, force: true }).catch(leaveSidecar);
      if (published) {
        await fs
          .rm(previous, { recursive: true, force: true })
          .catch(leaveSidecar);
      } else {
        await fs.rename(previous, dst).catch(ignoreMissing);
      }
    }
  }
  const firstTarget = path.join(skillPaths[0], name);
  const contentHash = await hashSkillDir(firstTarget);
  return { contentHash };
}

async function writeLocalSkill(
  name: SkillName,
  skillPaths: SkillPath[],
  content: string,
): Promise<void> {
  await withTempDir("platform-skill-upload-", async (tmp) => {
    await fs.writeFile(path.join(tmp, "SKILL.md"), content, "utf8");
    await write(name, skillPaths, tmp);
  });
}

async function existsInAnyPath(
  name: SkillName,
  skillPaths: SkillPath[],
): Promise<boolean> {
  for (const base of skillPaths) {
    try {
      await fs.access(path.join(base, name));
      return true;
    } catch {}
  }
  return false;
}

async function remove(name: SkillName, skillPaths: SkillPath[]): Promise<void> {
  for (const targetRoot of skillPaths) {
    const dst = path.join(targetRoot, name);
    await fs.rm(dst, { recursive: true, force: true });
  }
}

async function withTempDir<T>(
  prefix: string,
  fn: (dir: string) => Promise<T>,
): Promise<T> {
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
  if (opts.stripComponents !== undefined)
    args.push(`--strip-components=${opts.stripComponents}`);
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

export function subPathEscapes(subPath: string): boolean {
  return subPath.startsWith("/") || subPath.split("/").includes("..");
}

async function findSkillDirsInClone(
  repoDir: string,
  subPath?: string,
): Promise<string[]> {
  if (subPath && subPathEscapes(subPath)) {
    throw new Error(`skill source path rejected: ${subPath}`);
  }
  if (subPath) return skillDirsUnder(repoDir, path.join(repoDir, subPath));
  const found: string[] = [];
  for (const root of SKILL_SOURCE_ROOTS) {
    found.push(...(await skillDirsUnder(repoDir, path.join(repoDir, root))));
  }
  if (found.length > 0) return found;
  return skillDirsUnder(repoDir, repoDir);
}

async function skillDirsUnder(
  repoDir: string,
  root: string,
): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
    const dir = path.join(root, ent.name);
    try {
      await fs.access(path.join(dir, "SKILL.md"));
      out.push(path.relative(repoDir, dir));
    } catch {}
  }
  return out;
}

async function resolveSkillDirInClone(
  repoDir: string,
  name: SkillName,
  subPath?: string,
): Promise<Result<string, SkillsDomainError>> {
  if (subPath && subPathEscapes(subPath)) {
    return err({ kind: "SkillNotFoundInSource", source: repoDir, name });
  }
  const candidates = subPath
    ? [path.join(repoDir, subPath, name)]
    : [
        ...SKILL_SOURCE_ROOTS.map((root) => path.join(repoDir, root, name)),
        path.join(repoDir, name),
      ];
  for (const candidate of candidates) {
    try {
      await fs.access(path.join(candidate, "SKILL.md"));
      return ok(candidate);
    } catch {}
  }
  return err({ kind: "SkillNotFoundInSource", source: repoDir, name });
}

async function readSkillManifest(
  absDir: string,
): Promise<{ name?: string; description?: string }> {
  const content = await fs.readFile(path.join(absDir, "SKILL.md"), "utf8");
  return parseFrontmatter(content);
}

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

function ignoreMissing(err: unknown): void {
  if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}

function leaveSidecar(): void {}

async function assertNoSymlinks(root: string): Promise<void> {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    const entries = await fs.readdir(dir);
    for (const entryName of entries) {
      const full = path.join(dir, entryName);
      const st = await fs.lstat(full);
      if (st.isSymbolicLink()) {
        throw new Error(
          `skill rejected: symlink at ${path.relative(root, full)}`,
        );
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else if (!st.isFile()) {
        throw new Error(
          `skill rejected: non-regular file at ${path.relative(root, full)}`,
        );
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
      reject(
        new Error(
          `${cmd} ${args.join(" ")} timed out after ${COMMAND_TIMEOUT_MS}ms`,
        ),
      );
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
      reject(
        new Error(
          `${cmd} ${args.join(" ")} exited ${code}${stderr ? `: ${stderr}` : ""}`,
        ),
      );
    });
  });
}
