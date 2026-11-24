import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { type Context, Hono } from "hono";
import { Header } from "tar";
import { loadYamlDocument } from "../../../core/yaml-document.js";

const DISCOVERY_SCHEMA =
  "https://schemas.agentskills.io/discovery/0.2.0/schema.json";
const CACHE_CONTROL = "public, max-age=300";
const SKILL_FILE = "SKILL.md";
const TAR_BLOCK = 512;
const ARCHIVE_MTIME = new Date(0);

export interface AgentSkillFile {
  path: string;
  bytes: Uint8Array<ArrayBuffer>;
}

export interface AgentSkill {
  name: string;
  description: string;
  files: readonly AgentSkillFile[];
  archive: Uint8Array<ArrayBuffer>;
}

export interface AgentDiscoveryOptions {
  skill: AgentSkill | null;
  brandName: string;
  serverUrl: string;
  recommendedCliVersion: string | undefined;
}

const isHidden = (path: string) =>
  path.split("/").some((segment) => segment.startsWith("."));

function readSkillFiles(skillMdPath: string): AgentSkillFile[] {
  const dir = dirname(skillMdPath);
  return readdirSync(dir, { recursive: true, encoding: "utf-8" })
    .map((path) => path.split(sep).join("/"))
    .filter((path) => !isHidden(path) && statSync(join(dir, path)).isFile())
    .sort()
    .map((path) => ({
      path,
      bytes: new Uint8Array(readFileSync(join(dir, path))),
    }));
}

export function readAgentSkill(skillMdPath: string): AgentSkill | null {
  let skill: AgentSkill | null;
  try {
    skill = parseAgentSkill(readSkillFiles(skillMdPath));
  } catch (err) {
    process.stderr.write(
      `agent skill: ${skillMdPath}: ${err instanceof Error ? err.message : err}\n`,
    );
    return null;
  }
  if (skill === null)
    process.stderr.write(
      `agent skill: ${skillMdPath}: no name and description in its frontmatter\n`,
    );
  return skill;
}

export function parseAgentSkill(
  files: readonly AgentSkillFile[],
): AgentSkill | null {
  const skillMd = files.find((f) => f.path === SKILL_FILE);
  if (!skillMd) return null;
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(
    new TextDecoder().decode(skillMd.bytes),
  );
  if (!frontmatter) return null;
  let data: { name?: unknown; description?: unknown } | null;
  try {
    data = loadYamlDocument(frontmatter[1]!) as typeof data;
  } catch {
    return null;
  }
  if (typeof data?.name !== "string" || typeof data.description !== "string")
    return null;
  const ordered = [skillMd, ...files.filter((f) => f !== skillMd)];
  return {
    name: data.name,
    description: data.description.trim(),
    files: ordered,
    archive: skillArchive(ordered),
  };
}

function tarEntry({ path, bytes }: AgentSkillFile): Buffer[] {
  const header = new Header({
    path,
    mode: 0o644,
    uid: 0,
    gid: 0,
    size: bytes.byteLength,
    mtime: ARCHIVE_MTIME,
    type: "File",
  });
  if (header.encode())
    throw new Error(`${path}: needs a pax header, which the installer skips`);
  const padding = (TAR_BLOCK - (bytes.byteLength % TAR_BLOCK)) % TAR_BLOCK;
  return [header.block!, Buffer.from(bytes), Buffer.alloc(padding)];
}

function skillArchive(
  files: readonly AgentSkillFile[],
): Uint8Array<ArrayBuffer> {
  const tar = Buffer.concat([
    ...files.flatMap(tarEntry),
    Buffer.alloc(2 * TAR_BLOCK),
  ]);
  return new Uint8Array(gzipSync(tar));
}

const contentTypeOf = (path: string) =>
  path.endsWith(".md")
    ? "text/markdown; charset=utf-8"
    : "application/octet-stream";

export function llmsTxt(options: AgentDiscoveryOptions): string {
  const url = options.serverUrl.replace(/\/+$/, "");
  const cli = options.recommendedCliVersion
    ? `@dam-agents/cli@${options.recommendedCliVersion}`
    : "@dam-agents/cli";
  const skill = options.skill
    ? [
        "",
        "## Install the skill",
        "",
        `The \`${options.skill.name}\` skill teaches you the CLI. This server serves the copy that matches it:`,
        "",
        "```sh",
        `npx skills add ${url} -g`,
        "```",
        "",
        "Read the skill and follow it from then on.",
      ]
    : [];
  return [
    `# ${options.brandName}`,
    "",
    `> ${options.brandName} runs AI agents in isolated sandboxes on a server. The web app at ${url} needs JavaScript; an AI agent drives this deployment with the \`dam\` CLI instead.`,
    "",
    "## Install the CLI",
    "",
    "It needs Node.js 20 or newer.",
    "",
    "```sh",
    `npm install -g ${cli}`,
    "```",
    ...skill,
    "",
    "## Sign in",
    "",
    "```sh",
    `dam auth login --server ${url}`,
    "```",
    "",
    "The command prints a URL and a code. The user approves the sign-in in their browser.",
    "",
    "## Rules",
    "",
    "- You never see a secret. Never ask the user for a key, token or password: the CLI opens a page where the user types it.",
    `- Only the CLI talks to ${options.brandName}. Never call its API directly.`,
    "",
  ].join("\n");
}

// UNIT_BOUNDARY_DESCRIPTION: What an AI agent finds when it is given only this deployment's URL and fetches it without running JavaScript. /llms.txt says the deployment is driven by the dam CLI and how to install it and its skill. The skills installer (npx skills add <url>) reads the skill from the Agent Skills discovery index, which lists the skill this server ships with as one tar.gz of its files, SKILL.md and the pages beside it, so the agent gets the skill that matches this server. The legacy index, for older installers, names each file, and both serve each file on its own.
export function createAgentDiscoveryRoutes(options: AgentDiscoveryOptions) {
  const routes = new Hono();
  const text = llmsTxt(options);

  routes.get("/llms.txt", (c) => {
    c.header("Content-Type", "text/plain; charset=utf-8");
    c.header("Cache-Control", CACHE_CONTROL);
    return c.body(text);
  });

  const { skill } = options;
  if (skill === null) return routes;

  const archivePath = `${skill.name}.tar.gz`;
  const digest = `sha256:${createHash("sha256").update(skill.archive).digest("hex")}`;
  const serve =
    (bytes: Uint8Array<ArrayBuffer>, contentType: string) => (c: Context) => {
      c.header("Content-Type", contentType);
      c.header("Cache-Control", CACHE_CONTROL);
      return c.body(bytes);
    };

  routes.get("/.well-known/agent-skills/index.json", (c) => {
    c.header("Cache-Control", CACHE_CONTROL);
    return c.json({
      $schema: DISCOVERY_SCHEMA,
      skills: [
        {
          name: skill.name,
          description: skill.description,
          type: "archive",
          url: archivePath,
          digest,
        },
      ],
    });
  });
  routes.get(
    `/.well-known/agent-skills/${archivePath}`,
    serve(skill.archive, "application/gzip"),
  );

  routes.get("/.well-known/skills/index.json", (c) => {
    c.header("Cache-Control", CACHE_CONTROL);
    return c.json({
      skills: [
        {
          name: skill.name,
          description: skill.description,
          files: skill.files.map((f) => f.path),
        },
      ],
    });
  });

  for (const file of skill.files) {
    const handler = serve(file.bytes, contentTypeOf(file.path));
    routes.get(`/.well-known/agent-skills/${skill.name}/${file.path}`, handler);
    routes.get(`/.well-known/skills/${skill.name}/${file.path}`, handler);
  }

  return routes;
}
