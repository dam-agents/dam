import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as tar from "tar";
import { dedupeByName, SKILL_SOURCE_ROOTS } from "agent-runtime-api";
import type { Skill } from "api-server-api";
import { getLogger } from "../../../core/logger.js";
import { detectHost } from "../domain/git-host.js";
import type { SourcePathReason } from "../domain/scan-failure.js";

export class PublicArchiveNotFoundError extends Error {
  constructor(gitUrl: string) {
    super(`${gitUrl} is not a public GitHub repo`);
    this.name = "PublicArchiveNotFoundError";
  }
}

export class SkillSourcePathError extends Error {
  constructor(
    readonly reason: SourcePathReason,
    readonly path: string,
    readonly version: string,
  ) {
    super(`skill source path ${reason}: ${path}`);
    this.name = "SkillSourcePathError";
  }
}

const MAX_TARBALL_BYTES = 50 * 1024 * 1024;
const MAX_SKILL_MD_BYTES = 1024 * 1024;

interface Frontmatter {
  name?: string;
  description?: string;
}

export function parseFrontmatter(content: string): Frontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const lines = match[1].split(/\r?\n/);
  const out: Frontmatter = {};
  for (let i = 0; i < lines.length; i++) {
    const m = /^(name|description):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const key = m[1] as keyof Frontmatter;
    const raw = m[2].trim();
    const blockMatch = /^([>|])[+-]?$/.exec(raw);
    if (blockMatch) {
      const folded = blockMatch[1] === ">";
      const collected: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const line = lines[j];
        if (line.trim() === "") {
          collected.push("");
          j++;
          continue;
        }
        if (!/^\s+/.test(line)) break;
        collected.push(line.replace(/^\s+/, ""));
        j++;
      }
      while (collected.length > 0 && collected[collected.length - 1] === "")
        collected.pop();
      out[key] = folded ? collected.join(" ") : collected.join("\n");
      i = j - 1;
      continue;
    }
    const unquoted = raw.replace(/^["']|["']$/g, "");
    if (unquoted) out[key] = unquoted;
  }
  return out;
}

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function rec(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name.startsWith(".")) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) await rec(full);
      else if (ent.isFile()) out.push(full);
    }
  }
  await rec(root);
  return out;
}

export async function computeContentHash(absDir: string): Promise<string> {
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

function subPathEscapes(subPath: string): boolean {
  return subPath.startsWith("/") || subPath.split("/").includes("..");
}

function isMissingDir(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

async function findSkillDirs(
  repoDir: string,
  version: string,
  subPath?: string,
): Promise<string[]> {
  if (subPath) {
    if (subPathEscapes(subPath)) {
      throw new Error(`skill source path rejected: ${subPath}`);
    }
    const root = path.join(repoDir, subPath);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch (err) {
      if (isMissingDir(err)) {
        throw new SkillSourcePathError("path-missing", subPath, version);
      }
      throw err;
    }
    const dirs = await skillDirsIn(repoDir, root, entries);
    if (dirs.length === 0) {
      throw new SkillSourcePathError("path-empty", subPath, version);
    }
    return dirs;
  }
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
  return skillDirsIn(repoDir, root, entries);
}

async function skillDirsIn(
  repoDir: string,
  root: string,
  entries: import("node:fs").Dirent[],
): Promise<string[]> {
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

export async function scanPublicGithubArchive(
  gitUrl: string,
  subPath?: string,
): Promise<Skill[]> {
  const host = detectHost(gitUrl);
  if (!host)
    throw new Error(`only GitHub URLs supported for public scan: ${gitUrl}`);

  const archiveUrl = `https://github.com/${host.owner}/${host.repo}/archive/HEAD.tar.gz`;
  const res = await fetch(archiveUrl, { redirect: "follow" });
  if (res.status === 404) throw new PublicArchiveNotFoundError(gitUrl);
  if (!res.ok) throw new Error(`github archive ${res.status} for ${gitUrl}`);

  const shaMatch = res.url.match(/\/([0-9a-f]{40})(?:\?.*)?$/);
  if (!shaMatch) {
    if ((res.headers.get("content-type") ?? "").includes("text/html"))
      return [];
    throw new Error(`unexpected archive redirect: ${res.url}`);
  }
  const version = shaMatch[1];

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "platform-public-scan-"));
  try {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_TARBALL_BYTES) {
      throw new Error(`tarball too large: ${buf.byteLength} bytes`);
    }
    const tgz = path.join(tmp, "src.tgz");
    await fs.writeFile(tgz, buf);
    await tar.x({ file: tgz, cwd: tmp });
    await fs.rm(tgz);

    const extracted = (await fs.readdir(tmp, { withFileTypes: true })).filter(
      (e) => e.isDirectory(),
    );
    if (extracted.length === 0)
      throw new Error("tarball contained no directories");
    const repoDir = path.join(tmp, extracted[0].name);

    const skillDirs = await findSkillDirs(repoDir, version, subPath);
    const scanned = await Promise.all(
      skillDirs.map(async (rel) => {
        const absDir = path.join(repoDir, rel);
        const content = await fs.readFile(
          path.join(absDir, "SKILL.md"),
          "utf8",
        );
        const fm = parseFrontmatter(content);
        const contentHash = await computeContentHash(absDir);
        return {
          source: gitUrl,
          name: fm.name?.trim() || path.basename(rel),
          description: fm.description?.trim() || "",
          version,
          contentHash,
          dir: rel,
        };
      }),
    );
    const { kept, dropped } = dedupeByName(scanned);
    for (const d of dropped) {
      getLogger().warn(
        { source: gitUrl, name: d.name },
        "skills scan: dropped same-name skill from a later source root",
      );
    }
    return kept.sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

export async function readPublicGithubSkillFile(
  gitUrl: string,
  version: string,
  dir: string,
): Promise<string> {
  const host = detectHost(gitUrl);
  if (!host)
    throw new Error(`only GitHub URLs supported for public read: ${gitUrl}`);
  if (subPathEscapes(dir)) throw new Error(`skill dir rejected: ${dir}`);

  const rawUrl = `https://raw.githubusercontent.com/${host.owner}/${host.repo}/${version}/${dir}/SKILL.md`;
  const res = await fetch(rawUrl);
  if (res.status === 404) throw new PublicArchiveNotFoundError(gitUrl);
  if (!res.ok) throw new Error(`github raw ${res.status} for ${gitUrl}`);

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_SKILL_MD_BYTES) {
    throw new Error(`SKILL.md too large: ${buf.byteLength} bytes`);
  }
  return buf.toString("utf8");
}
