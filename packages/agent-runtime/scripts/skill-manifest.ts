import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseShippedSkillManifest,
  type ShippedSkillManifest,
} from "../src/modules/skills/domain/shipped-manifest.js";
import { hashSkillDir } from "../src/modules/skills/infrastructure/local-skill-repository.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const MANIFEST_REL = "packages/platform-base/skills-manifest.json";
const manifestFile = path.join(repoRoot, MANIFEST_REL);

function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function appendOnlyBaseRev(): string {
  for (const ref of ["origin/main", "main"]) {
    try {
      return git(["merge-base", ref, "HEAD"]).trim();
    } catch {}
  }
  console.error(
    "append-only check needs a baseline but neither origin/main nor main has a merge-base with HEAD",
  );
  process.exit(1);
}

function baselineManifest(baseRev: string): ShippedSkillManifest | undefined {
  if (git(["ls-tree", baseRev, "--", MANIFEST_REL]).trim() === "") {
    return undefined;
  }
  const parsed = parseShippedSkillManifest(
    JSON.parse(git(["show", `${baseRev}:${MANIFEST_REL}`])),
  );
  if (!parsed.ok) {
    console.error(
      `baseline ${MANIFEST_REL} at ${baseRev.slice(0, 12)} failed schema validation: ${parsed.error.reason}`,
    );
    process.exit(1);
  }
  return parsed.value;
}

function gitBuffer(args: string[]): Buffer {
  return execFileSync("git", args, {
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function skillSourceParents(): string[] {
  const parents = [
    "packages/platform-base/skills",
    "packages/platform-base/dam-skills",
  ];
  const agentsDir = path.join(repoRoot, "packages/agents");
  for (const ent of fs.readdirSync(agentsDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    parents.push(
      path.posix.join("packages/agents", ent.name, "workspace/.agents/skills"),
      path.posix.join("packages/agents", ent.name, "dam-skills"),
    );
  }
  return parents;
}

function currentSkillDirs(): { name: string; absDir: string }[] {
  const out: { name: string; absDir: string }[] = [];
  for (const parent of skillSourceParents()) {
    const absParent = path.join(repoRoot, parent);
    if (!fs.existsSync(absParent)) continue;
    for (const ent of fs.readdirSync(absParent, { withFileTypes: true })) {
      if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
      const absDir = path.join(absParent, ent.name);
      if (!fs.existsSync(path.join(absDir, "SKILL.md"))) continue;
      out.push({ name: ent.name, absDir });
    }
  }
  return out;
}

function loadManifest(): ShippedSkillManifest {
  if (!fs.existsSync(manifestFile)) return { manifestVersion: 1, skills: {} };
  const parsed = parseShippedSkillManifest(
    JSON.parse(fs.readFileSync(manifestFile, "utf8")),
  );
  if (!parsed.ok) {
    throw new Error(
      `${MANIFEST_REL} failed schema validation: ${parsed.error.reason}`,
    );
  }
  return parsed.value;
}

function saveManifest(manifest: ShippedSkillManifest): void {
  const skills: Record<string, string[]> = {};
  for (const name of Object.keys(manifest.skills).sort()) {
    skills[name] = manifest.skills[name];
  }
  fs.writeFileSync(
    manifestFile,
    `${JSON.stringify({ manifestVersion: 1, skills }, null, 2)}\n`,
  );
}

function appendHash(
  manifest: ShippedSkillManifest,
  name: string,
  hash: string,
): boolean {
  const hashes = (manifest.skills[name] ??= []);
  if (hashes.includes(hash)) return false;
  hashes.push(hash);
  return true;
}

async function generate(): Promise<void> {
  const manifest = loadManifest();
  let appended = 0;
  for (const { name, absDir } of currentSkillDirs()) {
    if (appendHash(manifest, name, await hashSkillDir(absDir))) {
      appended += 1;
      console.log(`appended ${name}`);
    }
  }
  saveManifest(manifest);
  console.log(`${MANIFEST_REL}: ${appended} hash(es) appended`);
}

async function check(): Promise<void> {
  const manifest = loadManifest();
  const problems: string[] = [];
  for (const { name, absDir } of currentSkillDirs()) {
    const hash = await hashSkillDir(absDir);
    if (!manifest.skills[name]?.includes(hash)) {
      problems.push(
        `${name}: current content is not in ${MANIFEST_REL} — run \`mise run skills:manifest:generate\``,
      );
    }
  }
  const base = baselineManifest(appendOnlyBaseRev());
  if (base) {
    for (const [name, hashes] of Object.entries(base.skills)) {
      for (const hash of hashes) {
        if (!manifest.skills[name]?.includes(hash)) {
          problems.push(
            `${name}: hash ${hash.slice(0, 12)}… was removed — the manifest is append-only`,
          );
        }
      }
    }
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(p);
    process.exit(1);
  }
  console.log(`${MANIFEST_REL}: ok`);
}

function historicalSkillDirs(): string[] {
  const dirs = new Set<string>();
  for (const parent of skillSourceParents()) {
    const listing = git([
      "log",
      "--format=",
      "--name-only",
      "--",
      `${parent}/`,
    ]);
    for (const line of listing.split("\n")) {
      const file = line.trim();
      if (!file.startsWith(`${parent}/`)) continue;
      const rest = file.slice(parent.length + 1);
      const child = rest.split("/")[0];
      if (child && !child.startsWith(".") && rest.includes("/")) {
        dirs.add(`${parent}/${child}`);
      }
    }
  }
  return [...dirs].sort();
}

async function hashDirAtCommit(
  commit: string,
  dir: string,
): Promise<string | undefined> {
  const files = git(["ls-tree", "-r", "--name-only", commit, "--", `${dir}/`])
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!files.includes(`${dir}/SKILL.md`)) return undefined;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-manifest-"));
  try {
    for (const file of files) {
      const rel = file.slice(dir.length + 1);
      const target = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, gitBuffer(["show", `${commit}:${file}`]));
    }
    return await hashSkillDir(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function backfill(): Promise<void> {
  const manifest = loadManifest();
  let appended = 0;
  for (const dir of historicalSkillDirs()) {
    const name = path.posix.basename(dir);
    const commits = git(["log", "--format=%H", "--", `${dir}/`])
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    for (const commit of commits) {
      const hash = await hashDirAtCommit(commit, dir);
      if (hash !== undefined && appendHash(manifest, name, hash)) {
        appended += 1;
        console.log(`appended ${name} @ ${commit.slice(0, 12)}`);
      }
    }
  }
  saveManifest(manifest);
  console.log(`${MANIFEST_REL}: ${appended} historical hash(es) appended`);
}

const command = process.argv[2];
if (command === "generate") await generate();
else if (command === "check") await check();
else if (command === "backfill") await backfill();
else {
  console.error("usage: skill-manifest.ts <generate|check|backfill>");
  process.exit(1);
}
