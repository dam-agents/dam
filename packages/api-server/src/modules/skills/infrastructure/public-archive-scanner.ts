import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as tar from "tar";
import { dedupeByName, parseGithubRepo } from "agent-runtime-api";
import {
  findSkillDirs,
  hashSkillDir,
  parseFrontmatter,
  subPathEscapes,
} from "agent-runtime-api/skill-tree";
import type { SourcePathReason } from "agent-runtime-api";
import type { Skill } from "api-server-api";
import { getLogger } from "../../../core/logger.js";

export class PublicArchiveNotFoundError extends Error {
  constructor(gitUrl: string) {
    super(`${gitUrl} is not a public GitHub repo`);
    this.name = "PublicArchiveNotFoundError";
  }
}

export class SkillSourcePathError extends Error {
  constructor(
    readonly reason: SourcePathReason,
    readonly subPath: string,
    readonly version: string,
  ) {
    super(`skill source path ${reason}: ${subPath}`);
    this.name = "SkillSourcePathError";
  }
}

const MAX_TARBALL_BYTES = 50 * 1024 * 1024;
const MAX_SKILL_MD_BYTES = 1024 * 1024;

export async function scanPublicGithubArchive(
  gitUrl: string,
  subPath?: string,
  ref = "HEAD",
): Promise<Skill[]> {
  const host = parseGithubRepo(gitUrl);
  if (!host)
    throw new Error(`only GitHub URLs supported for public scan: ${gitUrl}`);

  const archiveUrl = `https://github.com/${host.owner}/${host.repo}/archive/${encodeURIComponent(ref)}.tar.gz`;
  const res = await fetch(archiveUrl, { redirect: "follow" });
  if (res.status === 404) throw new PublicArchiveNotFoundError(gitUrl);
  if (!res.ok) throw new Error(`github archive ${res.status} for ${gitUrl}`);

  const shaMatch = res.url.match(/\/([0-9a-f]{40})(?:\?.*)?$/);
  if (!shaMatch && !/^[0-9a-f]{40}$/.test(ref)) {
    if ((res.headers.get("content-type") ?? "").includes("text/html"))
      return [];
    throw new Error(`unexpected archive redirect: ${res.url}`);
  }
  const version = shaMatch ? shaMatch[1] : ref;

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

    const found = await findSkillDirs(repoDir, subPath);
    if (found.kind !== "found") {
      throw new SkillSourcePathError(found.kind, found.subPath, version);
    }
    const skillDirs = found.dirs;
    const scanned = await Promise.all(
      skillDirs.map(async (rel) => {
        const absDir = path.join(repoDir, rel);
        const content = await fs.readFile(
          path.join(absDir, "SKILL.md"),
          "utf8",
        );
        const fm = parseFrontmatter(content);
        const contentHash = await hashSkillDir(absDir);
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
  const host = parseGithubRepo(gitUrl);
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
