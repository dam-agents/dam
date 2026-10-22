import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { SKILL_SOURCE_ROOTS } from "./source-roots.js";
import type { SourcePathReason } from "./types.js";

export interface SkillFrontmatter {
  name?: string;
  description?: string;
}

export function parseFrontmatter(content: string): SkillFrontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const lines = match[1].split(/\r?\n/);
  const out: SkillFrontmatter = {};

  for (let i = 0; i < lines.length; i++) {
    const m = /^(name|description):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const key = m[1] as keyof SkillFrontmatter;
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

export function subPathEscapes(subPath: string): boolean {
  return subPath.startsWith("/") || subPath.split("/").includes("..");
}

export async function walkSkillFiles(root: string): Promise<string[]> {
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

export async function hashSkillDir(absDir: string): Promise<string> {
  const files = (await walkSkillFiles(absDir)).sort();
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

export type SkillDirOutcome =
  | { kind: "found"; dirs: string[] }
  | { kind: SourcePathReason; subPath: string };

export async function findSkillDirs(
  repoDir: string,
  subPath?: string,
): Promise<SkillDirOutcome> {
  if (subPath && subPathEscapes(subPath)) {
    throw new Error(`skill source path rejected: ${subPath}`);
  }
  if (subPath) {
    const root = path.join(repoDir, subPath);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch (err) {
      if (isMissingDir(err)) return { kind: "path-missing", subPath };
      throw err;
    }
    const dirs = [
      ...((await isSkillDir(root)) ? [path.relative(repoDir, root)] : []),
      ...(await skillDirsIn(repoDir, root, entries)),
    ];
    return dirs.length > 0
      ? { kind: "found", dirs }
      : { kind: "path-empty", subPath };
  }
  const found: string[] = [];
  for (const root of SKILL_SOURCE_ROOTS) {
    found.push(...(await skillDirsUnder(repoDir, path.join(repoDir, root))));
  }
  return {
    kind: "found",
    dirs: found.length > 0 ? found : await skillDirsUnder(repoDir, repoDir),
  };
}

function isMissingDir(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  return code === "ENOENT" || code === "ENOTDIR";
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

async function isSkillDir(dir: string): Promise<boolean> {
  try {
    await fs.access(path.join(dir, "SKILL.md"));
    return true;
  } catch {
    return false;
  }
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
