import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as tar from "tar";
import type { Skill } from "api-server-api";
import { detectHost } from "./git-host.js";

/**
 * Scan a public GitHub source directly — no OneCLI, no git binary, no auth.
 *
 * api-server has direct internet egress (no NetworkPolicy applies to it),
 * so it can hit `github.com/{owner}/{repo}/archive/HEAD.tar.gz` without
 * going through OneCLI's MITM. That endpoint:
 *   - Returns 302 → codeload.github.com/.../tar.gz/{FULL_SHA} on public repos
 *     (full commit SHA in the redirect URL — recoverable from response.url).
 *   - Returns 404 for private repos and nonexistent ones alike — caller
 *     falls back to agent-runtime to distinguish + surface a CTA.
 *   - Has no api.github.com-style rate limit (tarball endpoint is a separate
 *     budget and effectively unlimited for our one-per-5-min cache cadence).
 *
 * The chosen architecture makes public-source scans work in every OneCLI
 * state — unconfigured, configured but not Connected, Connected but agent
 * not granted, or fully connected + granted — which is a hard product
 * requirement (see docs/plans/skills/11-scan-in-api-server.md).
 */
export class PublicArchiveNotFoundError extends Error {
  constructor(gitUrl: string) {
    super(`${gitUrl} is not a public GitHub repo`);
    this.name = "PublicArchiveNotFoundError";
  }
}

const MAX_TARBALL_BYTES = 50 * 1024 * 1024; // 50 MB cap — catalog repos are ~100-500 KB typical.

interface Frontmatter { name?: string; description?: string; }

/** YAML frontmatter parser — handles plain scalars, `>` folded, and `|`
 *  literal block scalars. Duplicated from agent-runtime's scanner to keep
 *  the two scanners dependency-isolated. */
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
      while (collected.length > 0 && collected[collected.length - 1] === "") collected.pop();
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

/**
 * Deterministic SHA-256 of a skill directory's contents. Hashes every file
 * under the dir in sorted-path order, mixing the relative path and body
 * bytes so both path-level and content-level changes flip the hash. No
 * external git data needed — purely a function of what's on disk.
 */
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

async function findSkillDirs(repoDir: string): Promise<string[]> {
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
      } catch { /* no SKILL.md → not a skill dir */ }
    }
    if (found.length > 0) return found;
  }
  return found;
}

/**
 * Scan a public GitHub repo via the anonymous archive endpoint.
 * Throws `PublicArchiveNotFoundError` on 404 so the caller can fall through
 * to the authenticated agent-runtime path.
 */
export async function scanPublicGithubArchive(gitUrl: string): Promise<Skill[]> {
  const host = detectHost(gitUrl);
  if (!host) throw new Error(`only GitHub URLs supported for public scan: ${gitUrl}`);

  const archiveUrl = `https://github.com/${host.owner}/${host.repo}/archive/HEAD.tar.gz`;
  const res = await fetch(archiveUrl, { redirect: "follow" });
  if (res.status === 404) throw new PublicArchiveNotFoundError(gitUrl);
  if (!res.ok) throw new Error(`github archive ${res.status} for ${gitUrl}`);

  // The final URL is `codeload.github.com/{owner}/{repo}/tar.gz/{FULL_SHA}`.
  // Pick the trailing 40-char hex SHA.
  const shaMatch = res.url.match(/\/([0-9a-f]{40})(?:\?.*)?$/);
  if (!shaMatch) throw new Error(`unexpected archive redirect: ${res.url}`);
  const version = shaMatch[1];

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "humr-public-scan-"));
  try {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_TARBALL_BYTES) {
      throw new Error(`tarball too large: ${buf.byteLength} bytes`);
    }
    const tgz = path.join(tmp, "src.tgz");
    await fs.writeFile(tgz, buf);
    await tar.x({ file: tgz, cwd: tmp });
    await fs.rm(tgz);

    const extracted = (await fs.readdir(tmp, { withFileTypes: true })).filter((e) => e.isDirectory());
    if (extracted.length === 0) throw new Error("tarball contained no directories");
    const repoDir = path.join(tmp, extracted[0].name);

    const skillDirs = await findSkillDirs(repoDir);
    const out = await Promise.all(
      skillDirs.map(async (rel) => {
        const absDir = path.join(repoDir, rel);
        const content = await fs.readFile(path.join(absDir, "SKILL.md"), "utf8");
        const fm = parseFrontmatter(content);
        const contentHash = await computeContentHash(absDir);
        return {
          source: gitUrl,
          name: fm.name?.trim() || path.basename(rel),
          description: fm.description?.trim() || "",
          version,
          contentHash,
        };
      }),
    );
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
