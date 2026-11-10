import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  type AgentSkill,
  type AgentSkillFile,
  createAgentDiscoveryRoutes,
  parseAgentSkill,
  readAgentSkill,
} from "../../apps/api-server/routes/agent-discovery.js";

/**
 * TEST_OVERVIEW: An AI agent given only a deployment's URL fetches it without
 * running JavaScript. The api-server answers /llms.txt with how to install the
 * dam CLI and its skill, and the Agent Skills discovery index, which the
 * skills installer (npx skills add <url>, skills CLI 1.7.2) reads, lists the
 * skill the server ships with. The skill is SKILL.md and the pages beside it,
 * such as its security advisory, so the 0.2.0 index lists it as one tar.gz
 * archive with SKILL.md at its root. The installer accepts an entry only with
 * the 0.2.0 schema, a name, a description, a type, a url relative to the index
 * and the sha256 digest of the bytes the url answers, and it reads the archive
 * as plain ustar entries. The legacy index names every file.
 */

const SKILL_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../skills/dam/SKILL.md",
);

const SKILL_MD =
  "---\nname: dam\ndescription: >\n  Drive DAM with the dam CLI.\n---\n\nBody.\n";
const ADVISORY_MD = "# Security advisory\n\nUse connections.\n";

const fileOf = (path: string, text: string): AgentSkillFile => ({
  path,
  bytes: new TextEncoder().encode(text),
});

function skillOf(files: AgentSkillFile[]): AgentSkill {
  const skill = parseAgentSkill(files);
  if (skill === null) throw new Error("fixture has no frontmatter");
  return skill;
}

const SKILL = skillOf([
  fileOf("references/security-advisory.md", ADVISORY_MD),
  fileOf("SKILL.md", SKILL_MD),
]);

function routes(skill: AgentSkill | null = SKILL) {
  return createAgentDiscoveryRoutes({
    skill,
    brandName: "DAM",
    serverUrl: "https://dam.example.com/",
    recommendedCliVersion: "0.2.24",
  });
}

function unpackLikeTheInstaller(archive: Uint8Array): Map<string, string> {
  const tar = gunzipSync(archive);
  const field = (from: number, length: number) =>
    tar
      .subarray(from, from + length)
      .toString("utf-8")
      .replace(/\0[\s\S]*$/, "");
  const files = new Map<string, string>();
  let offset = 0;
  while (
    offset + 512 <= tar.length &&
    tar.subarray(offset, offset + 512).some((b) => b !== 0)
  ) {
    const name = field(offset, 100);
    const prefix = field(offset + 345, 155);
    const size = Number.parseInt(field(offset + 124, 12).trim() || "0", 8);
    const type = tar[offset + 156];
    offset += 512;
    if (type === 0x30 || type === 0)
      files.set(
        prefix ? `${prefix}/${name}` : name,
        tar.subarray(offset, offset + size).toString("utf-8"),
      );
    offset += Math.ceil(size / 512) * 512;
  }
  return files;
}

describe("agent discovery routes", () => {
  /**
   * TEST_SCENARIO: The installer fetches the index, then the url of each
   * entry resolved against the index, refuses the skill when the bytes do not
   * hash to the entry's digest, and installs the files the archive holds.
   */
  it("lists the skill in the 0.2.0 index as an archive of all its files", async () => {
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
        type: "archive",
        url: "dam.tar.gz",
        digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    ]);

    const url = new URL(
      body.skills[0]!.url,
      "https://dam.example.com/.well-known/agent-skills/index.json",
    );
    const file = await app.request(url.pathname);
    expect(file.status).toBe(200);
    expect(file.headers.get("Content-Type")).toBe("application/gzip");
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect(body.skills[0]!.digest).toBe(
      `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    );
    expect(unpackLikeTheInstaller(bytes)).toEqual(
      new Map([
        ["SKILL.md", SKILL_MD],
        ["references/security-advisory.md", ADVISORY_MD],
      ]),
    );
  });

  /**
   * TEST_SCENARIO: Each api-server replica builds the archive at boot, and the
   * index from one replica can be followed by the archive from another, so
   * the same files must give the same bytes whatever the clock says.
   */
  it("builds the same archive bytes from the same files", () => {
    vi.useFakeTimers({ now: new Date("2031-05-06T07:08:09Z") });
    try {
      const again = skillOf([
        fileOf("SKILL.md", SKILL_MD),
        fileOf("references/security-advisory.md", ADVISORY_MD),
      ]);
      expect(again.archive).toEqual(SKILL.archive);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * TEST_SCENARIO: An installer older than the 0.2.0 schema reads the legacy
   * index, whose entry names its files, SKILL.md first, and fetches each under
   * the skill's name.
   */
  it("serves the legacy index and every file it names", async () => {
    const app = routes();
    const index = await app.request("/.well-known/skills/index.json");
    expect(await index.json()).toEqual({
      skills: [
        {
          name: "dam",
          description: "Drive DAM with the dam CLI.",
          files: ["SKILL.md", "references/security-advisory.md"],
        },
      ],
    });
    const skillMd = await app.request("/.well-known/skills/dam/SKILL.md");
    expect(skillMd.headers.get("Content-Type")).toContain("text/markdown");
    expect(await skillMd.text()).toBe(SKILL_MD);
    const advisory = await app.request(
      "/.well-known/skills/dam/references/security-advisory.md",
    );
    expect(await advisory.text()).toBe(ADVISORY_MD);
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
   * TEST_SCENARIO: The image ships the repository's dam skill folder, and the
   * index takes its name and description from the skill's own frontmatter,
   * within the 1024 characters the installer accepts. The archive holds
   * SKILL.md and the security advisory it links to, as the repository has them.
   */
  it("reads the repository's dam skill", () => {
    const skill = readAgentSkill(SKILL_PATH);
    expect(skill?.name).toBe("dam");
    expect(skill?.description.length).toBeGreaterThan(0);
    expect(skill?.description.length).toBeLessThanOrEqual(1024);
    const unpacked = unpackLikeTheInstaller(skill!.archive);
    expect(unpacked.get("SKILL.md")).toBe(readFileSync(SKILL_PATH, "utf-8"));
    expect(unpacked.get("references/security-advisory.md")).toBe(
      readFileSync(
        join(dirname(SKILL_PATH), "references/security-advisory.md"),
        "utf-8",
      ),
    );
  });

  /**
   * TEST_SCENARIO: A checkout or an editor can leave hidden files, such as
   * .DS_Store, in the skill's folder; they are not part of the skill.
   */
  it("leaves hidden files out of the skill", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-skill-"));
    mkdirSync(join(dir, "references"));
    writeFileSync(join(dir, "SKILL.md"), SKILL_MD);
    writeFileSync(join(dir, "references", "security-advisory.md"), ADVISORY_MD);
    writeFileSync(join(dir, ".DS_Store"), "junk");
    expect(
      readAgentSkill(join(dir, "SKILL.md"))?.files.map((f) => f.path),
    ).toEqual(["SKILL.md", "references/security-advisory.md"]);
  });

  /**
   * TEST_SCENARIO: A broken skill file must not stop the api-server from
   * booting: it serves llms.txt without the skill instead.
   */
  it("reads no skill from a file without valid frontmatter", () => {
    const parse = (text: string) => parseAgentSkill([fileOf("SKILL.md", text)]);
    expect(parse("# no frontmatter")).toBe(null);
    expect(parse("---\nname: [dam\n---\n")).toBe(null);
    expect(parse("---\nname: dam\n---\n")).toBe(null);
    expect(parseAgentSkill([fileOf("README.md", SKILL_MD)])).toBe(null);
  });
});
