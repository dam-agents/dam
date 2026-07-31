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
  /** First-wins listing across skillPaths, dot-prefixed entries skipped,
   *  frontmatter parsed via the 8 KB fast-path. With `pristinePaths`, each
   *  skill is stamped with an `origin`; without them the listing carries
   *  none (name-only callers skip the classification cost). */
  listLocal: (
    skillPaths: SkillPath[],
    pristinePaths?: SkillPath[],
  ) => Promise<LocalSkill[]>;
  /** Read every file in a skill's directory, enforcing the per-file and
   *  per-skill caps. Returns the resolved directory basename alongside the
   *  files, so a caller can name a download from the on-disk identity rather
   *  than re-slugging the display name. Errors with `SkillNotFound` when no
   *  skillPath contains the named skill, `PayloadTooLarge` on cap breach. */
  readLocal: (
    name: SkillName,
    skillPaths: SkillPath[],
  ) => Promise<
    Result<{ dir: string; files: LocalSkillFile[] }, SkillsDomainError>
  >;
  /** Resolve a Local Skill's directory from the name a caller holds. Tries
   *  `<skillPath>/<name>` first — the on-disk identity, which install and the
   *  driver pass — then matches a directory's frontmatter `name:`, which is
   *  what listLocal reports and therefore what the UI sends. First match wins
   *  in skillPath order, mirroring listLocal's dedupe. */
  resolveLocalSkillDir: (
    name: SkillName,
    skillPaths: SkillPath[],
  ) => Promise<{ absDir: string; dir: SkillName } | null>;
  /** Mirror `srcDir`'s contents into `<skillPath>/<name>/` for every path,
   *  overwriting any prior installation. Returns the deterministic content
   *  hash of the first installed dir (all targets get identical contents). */
  writeFromDir: (
    name: SkillName,
    skillPaths: SkillPath[],
    srcDir: string,
  ) => Promise<{ contentHash: string }>;
  /** Materialize a single-file skill: write `content` as `SKILL.md` into a
   *  temp dir and mirror it into `<skillPath>/<name>/` for every path. */
  writeLocalSkill: (
    name: SkillName,
    skillPaths: SkillPath[],
    content: string,
  ) => Promise<void>;
  /** True if `<skillPath>/<name>` exists in any path (as any entry, with or
   *  without a SKILL.md) — the collision guard for writeLocal. */
  existsInAnyPath: (
    name: SkillName,
    skillPaths: SkillPath[],
  ) => Promise<boolean>;
  /** Remove `<skillPath>/<name>/` from every path. */
  remove: (name: SkillName, skillPaths: SkillPath[]) => Promise<void>;
  /** Allocate a tmpdir, run `fn` against it, then unconditionally clean up. */
  withTempDir: <T>(
    prefix: string,
    fn: (dir: string) => Promise<T>,
  ) => Promise<T>;
  /** Untar a tarball buffer into `dest`, stripping the top-level wrapper
   *  directory that GitHub tarballs add. Used by both scan (no strip) and
   *  install (strip 1). */
  extractTarball: (
    bytes: Uint8Array,
    dest: string,
    opts: { stripComponents?: number },
  ) => Promise<void>;
  /** Walk a freshly-cloned/extracted repo and return every directory
   *  (relative to `repoDir`) that contains a SKILL.md. With `subPath`, scans
   *  that subdir exclusively; otherwise unions the deliberate
   *  `SKILL_SOURCE_ROOTS` in order, with top-level `*` only when none matched.
   *  May contain same-name collisions — callers dedupe via `dedupeByName`. */
  findSkillDirsInClone: (
    repoDir: string,
    subPath?: string,
  ) => Promise<string[]>;
  /** Resolve the directory inside a clone where the named skill lives. With
   *  `subPath`, looks at `<subPath>/<name>/` exclusively; otherwise tries each
   *  `SKILL_SOURCE_ROOTS`/<name> in order, then top-level <name>. */
  resolveSkillDirInClone: (
    repoDir: string,
    name: SkillName,
    subPath?: string,
  ) => Promise<Result<string, SkillsDomainError>>;
  /** Read SKILL.md frontmatter for a directory inside a clone. */
  readSkillManifest: (
    absDir: string,
  ) => Promise<{ name?: string; description?: string }>;
  /** Deterministic SHA-256 over a skill directory's contents. */
  hashSkillDir: (absDir: string) => Promise<string>;
}

export function createLocalSkillRepository(): LocalSkillRepository {
  // Image is immutable in-process: pristine hashes memoize once per dir.
  const pristineHashes = new Map<string, Promise<string | null>>();
  return {
    listLocal: (skillPaths, pristinePaths) =>
      list(skillPaths, pristinePaths, pristineHashes),
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
  /** The dirent basename — the skill's on-disk identity, which diverges from
   *  `name` whenever frontmatter supplies one. */
  dir: SkillName;
}

/** Walk every skillPath in order, first-wins by directory name. Unsorted, so
 *  the caller sees skillPath precedence; `list` sorts for the wire. */
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
          // A dirent basename can carry no `/` and is never `.`/`..`, and
          // dot-prefixed entries are skipped above — so it satisfies
          // makeSkillName by construction.
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
): Promise<LocalSkill[]> {
  const out: LocalSkill[] = [];
  for (const { dir, name, description, skillPath } of await listEntries(
    skillPaths,
  )) {
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
            ),
          }
        : {}),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function resolveLocalSkillDir(
  name: SkillName,
  skillPaths: SkillPath[],
): Promise<{ absDir: string; dir: SkillName } | null> {
  // Exact directory first, deliberately: a caller holding a directory name
  // whose frontmatter `name:` differs would otherwise resolve to the wrong
  // skill (or nothing).
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

/** Identity is the directory basename (what install/dedupe key on); the
 *  verdict is the domain's {@link judgeOrigin} — this only acquires hashes,
 *  the local one lazily. */
async function classifyOrigin(
  dirName: string,
  localDir: string,
  pristinePaths: SkillPath[],
  pristineHashes: Map<string, Promise<string | null>>,
): Promise<SkillOrigin> {
  const pristineHash = await firstPristineHash(
    dirName,
    pristinePaths,
    pristineHashes,
  );
  // Guarded on both sides: an unhashable local copy (unreadable file, a
  // deletion racing the listing) must degrade, never throw the listing away.
  const localHash =
    pristineHash === null ? null : await hashSkillDirIfPresent(localDir);
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

/** null when the directory is absent, unreadable, or not a skill (no
 *  SKILL.md — keeps non-skill dirs in a pristine root, e.g. the staged kit's
 *  `commands/`, from counting as counterparts). */
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

/** A configured source subdir is api-server-validated, but guard at the join
 *  site too so a stray `..`/absolute path can never escape the clone. */
function subPathEscapes(subPath: string): boolean {
  return subPath.startsWith("/") || subPath.split("/").includes("..");
}

async function findSkillDirsInClone(
  repoDir: string,
  subPath?: string,
): Promise<string[]> {
  if (subPath && subPathEscapes(subPath)) {
    throw new Error(`skill source path rejected: ${subPath}`);
  }
  // An explicit subdir is scanned exclusively — no source-root union or root
  // fallback, so the user gets exactly the directory they pointed at.
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
