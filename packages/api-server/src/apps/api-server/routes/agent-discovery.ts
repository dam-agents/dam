import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { type Context, Hono } from "hono";
import { loadYamlDocument } from "../../../core/yaml-document.js";

const DISCOVERY_SCHEMA = "https://schemas.agentskills.io/discovery/0.2.0/schema.json";
const CACHE_CONTROL = "public, max-age=300";

export interface AgentSkill {
  name: string;
  description: string;
  bytes: Uint8Array<ArrayBuffer>;
}

export interface AgentDiscoveryOptions {
  skill: AgentSkill | null;
  brandName: string;
  serverUrl: string;
  recommendedCliVersion: string | undefined;
}

export function readAgentSkill(path: string): AgentSkill | null {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (err) {
    process.stderr.write(
      `agent skill: ${path}: ${err instanceof Error ? err.message : err}\n`,
    );
    return null;
  }
  const skill = parseAgentSkill(new Uint8Array(bytes));
  if (skill === null)
    process.stderr.write(
      `agent skill: ${path}: no name and description in its frontmatter\n`,
    );
  return skill;
}

export function parseAgentSkill(
  bytes: Uint8Array<ArrayBuffer>,
): AgentSkill | null {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(
    new TextDecoder().decode(bytes),
  );
  if (!frontmatter) return null;
  const data = loadYamlDocument(frontmatter[1]!) as {
    name?: unknown;
    description?: unknown;
  } | null;
  if (typeof data?.name !== "string" || typeof data.description !== "string")
    return null;
  return { name: data.name, description: data.description.trim(), bytes };
}

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

// UNIT_BOUNDARY_DESCRIPTION: What an AI agent finds when it is given only this deployment's URL and fetches it without running JavaScript. /llms.txt says the deployment is driven by the dam CLI and how to install it and its skill. The skills installer (npx skills add <url>) reads the skill from the Agent Skills discovery index, which lists the SKILL.md this server ships with, so the agent gets the skill that matches this server. The legacy index serves older installers.
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

  const digest = `sha256:${createHash("sha256").update(skill.bytes).digest("hex")}`;
  const serveSkill = (c: Context) => {
    c.header("Content-Type", "text/markdown; charset=utf-8");
    c.header("Cache-Control", CACHE_CONTROL);
    return c.body(skill.bytes);
  };

  routes.get("/.well-known/agent-skills/index.json", (c) => {
    c.header("Cache-Control", CACHE_CONTROL);
    return c.json({
      $schema: DISCOVERY_SCHEMA,
      skills: [
        {
          name: skill.name,
          description: skill.description,
          type: "skill-md",
          url: `${skill.name}/SKILL.md`,
          digest,
        },
      ],
    });
  });
  routes.get(`/.well-known/agent-skills/${skill.name}/SKILL.md`, serveSkill);

  routes.get("/.well-known/skills/index.json", (c) => {
    c.header("Cache-Control", CACHE_CONTROL);
    return c.json({
      skills: [
        {
          name: skill.name,
          description: skill.description,
          files: ["SKILL.md"],
        },
      ],
    });
  });
  routes.get(`/.well-known/skills/${skill.name}/SKILL.md`, serveSkill);

  return routes;
}
