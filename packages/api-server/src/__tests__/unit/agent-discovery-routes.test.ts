import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type AgentSkill,
  createAgentDiscoveryRoutes,
  parseAgentSkill,
  readAgentSkill,
} from "../../apps/api-server/routes/agent-discovery.js";

/**
 * TEST_OVERVIEW: An AI agent given only a deployment's URL fetches it without
 * running JavaScript. The api-server answers /llms.txt with how to install the
 * dam CLI and its skill, and the Agent Skills discovery index, which the
 * skills installer (npx skills add <url>, skills CLI 1.7.2) reads, lists the
 * skill the server ships with. The installer accepts an entry only with the
 * 0.2.0 schema, a name, a description, a type, a url relative to the index
 * and the sha256 digest of the bytes the url answers.
 */

const SKILL_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../skills/dam/SKILL.md",
);

function skillOf(markdown: string): AgentSkill {
  const skill = parseAgentSkill(new TextEncoder().encode(markdown));
  if (skill === null) throw new Error("fixture has no frontmatter");
  return skill;
}

const SKILL = skillOf(
  "---\nname: dam\ndescription: >\n  Drive DAM with the dam CLI.\n---\n\nBody.\n",
);

function routes(skill: AgentSkill | null = SKILL) {
  return createAgentDiscoveryRoutes({
    skill,
    brandName: "DAM",
    serverUrl: "https://dam.example.com/",
    recommendedCliVersion: "0.2.24",
  });
}

describe("agent discovery routes", () => {
  /**
   * TEST_SCENARIO: The installer fetches the index, then the url of each
   * entry resolved against the index, and refuses the skill when the bytes do
   * not hash to the entry's digest.
   */
  it("lists the skill in the 0.2.0 index with the digest of the bytes it serves", async () => {
    const app = routes();
    const index = await app.request("/.well-known/agent-skills/index.json");
    expect(index.status).toBe(200);
    const body = (await index.json()) as {
      $schema: string;
      skills: { name: string; type: string; url: string; digest: string }[];
    };
    expect(body.$schema).toBe(
      "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    );
    expect(body.skills).toEqual([
      {
        name: "dam",
        description: "Drive DAM with the dam CLI.",
        type: "skill-md",
        url: "dam/SKILL.md",
        digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    ]);

    const url = new URL(
      body.skills[0]!.url,
      "https://dam.example.com/.well-known/agent-skills/index.json",
    );
    const file = await app.request(url.pathname);
    expect(file.status).toBe(200);
    expect(file.headers.get("Content-Type")).toContain("text/markdown");
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect(bytes).toEqual(SKILL.bytes);
    expect(body.skills[0]!.digest).toBe(
      `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    );
  });

  /**
   * TEST_SCENARIO: An installer older than the 0.2.0 schema reads the legacy
   * index, whose entry names its files, and fetches each under the skill's
   * name.
   */
  it("serves the legacy index and the file it names", async () => {
    const app = routes();
    const index = await app.request("/.well-known/skills/index.json");
    expect(await index.json()).toEqual({
      skills: [
        {
          name: "dam",
          description: "Drive DAM with the dam CLI.",
          files: ["SKILL.md"],
        },
      ],
    });
    const file = await app.request("/.well-known/skills/dam/SKILL.md");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(SKILL.bytes);
  });

  /**
   * TEST_SCENARIO: llms.txt is all an agent reads before it knows the CLI, so
   * it names the CLI version the server recommends, the install of the skill
   * from this server, the sign-in, and the rules on secrets and the API.
   */
  it("tells an agent in llms.txt how to install the CLI and the skill and sign in", async () => {
    const res = await routes().request("/llms.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    const text = await res.text();
    expect(text).toMatch(/^# DAM\n/);
    expect(text).toContain("npm install -g @dam-agents/cli@0.2.24");
    expect(text).toContain("npx skills add https://dam.example.com -g");
    expect(text).toContain("dam auth login --server https://dam.example.com");
    expect(text).toContain("You never see a secret");
    expect(text).toContain("Never call its API directly");
  });

  /**
   * TEST_SCENARIO: A build from main recommends no CLI version, and a server
   * whose skill file is missing lists no index: llms.txt then says neither,
   * and the index paths answer 404 rather than an empty list.
   */
  it("leaves out what the server does not have", async () => {
    const app = createAgentDiscoveryRoutes({
      skill: null,
      brandName: "DAM",
      serverUrl: "https://dam.example.com",
      recommendedCliVersion: undefined,
    });
    const text = await (await app.request("/llms.txt")).text();
    expect(text).toContain("npm install -g @dam-agents/cli\n");
    expect(text).not.toContain("npx skills add");
    expect(
      (await app.request("/.well-known/agent-skills/index.json")).status,
    ).toBe(404);
    expect((await app.request("/.well-known/skills/index.json")).status).toBe(
      404,
    );
  });

  /**
   * TEST_SCENARIO: The image ships the repository's dam skill, and the index
   * takes its name and description from the skill's own frontmatter, within
   * the 1024 characters the installer accepts.
   */
  it("reads the repository's dam skill", () => {
    const skill = readAgentSkill(SKILL_PATH);
    expect(skill?.name).toBe("dam");
    expect(skill?.description.length).toBeGreaterThan(0);
    expect(skill?.description.length).toBeLessThanOrEqual(1024);
    expect(skill?.bytes).toEqual(new Uint8Array(readFileSync(SKILL_PATH)));
  });

  it("reads no skill from a file without frontmatter", () => {
    expect(parseAgentSkill(new TextEncoder().encode("# no frontmatter"))).toBe(
      null,
    );
  });
});
