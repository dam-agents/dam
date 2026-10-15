// TEST_OVERVIEW: The api-server reads an agent's egress rules to decide how its pod fetches a GitHub skill source: the archive as before, only the source path's directory when the rules deny the archive, or a refused install that tells the user to set a path the agent may read.
import { describe, expect, it } from "vitest";
import { planSourceFetch, type EgressDenies } from "agent-runtime-api";
import type { AgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import type { AgentSkillsRepository } from "../../modules/skills/infrastructure/agent-skills-repository.js";
import type { SkillsRepository } from "../../modules/skills/infrastructure/skills-repository.js";
import {
  createSkillsService,
  type SkillsServiceDeps,
} from "../../modules/skills/services/skills-service.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const URL = "https://github.com/dam-agents/dam";

const denyRules: { host: string; pattern: string; verdict: string }[] = [
  {
    host: "api.github.com",
    pattern: "/repos/dam-agents/dam/*",
    verdict: "deny",
  },
  {
    host: "codeload.github.com",
    pattern: "/dam-agents/dam/*",
    verdict: "deny",
  },
  {
    host: "api.github.com",
    pattern: "/repos/dam-agents/dam/contents/qa/*",
    verdict: "allow",
  },
  {
    host: "api.github.com",
    pattern: "/repos/dam-agents/dam/contents/qa?*",
    verdict: "allow",
  },
];

const qaAgentDenies: EgressDenies = async (host, _method, path) => {
  const match = denyRules
    .filter((r) => r.host === host && path.startsWith(r.pattern.slice(0, -1)))
    .sort((a, b) => b.pattern.length - a.pattern.length)[0];
  return match?.verdict === "deny";
};

describe("planSourceFetch", () => {
  // TEST_SCENARIO: the QA agent denies the repository and its archive host but allows contents/qa/* and contents/qa?*, so a source with path qa is fetched by directory, one without a path or with another path is refused, and an agent with no deny rule keeps the archive.
  it.each([
    [qaAgentDenies, "qa", { kind: "directory" }],
    [qaAgentDenies, undefined, { kind: "blocked", reason: "no-path" }],
    [qaAgentDenies, "packages", { kind: "blocked", reason: "path-denied" }],
    [async () => false, "qa", { kind: "archive" }],
  ] as const)("plans %#", async (denies, path, expected) => {
    expect(
      await planSourceFetch({ url: URL, path, version: SHA }, denies),
    ).toEqual(expected);
  });
});

describe("skills install under egress rules", () => {
  // TEST_SCENARIO: installing from a source whose archive the agent's egress denies, with no path set, fails before anything is recorded, with a message that tells the user to set a path.
  it("refuses an install the agent could not fetch and records nothing", async () => {
    const upserts: unknown[] = [];
    const service = createSkillsService({
      agentsRepo: {
        get: async () => ({ id: "agent-1", ready: true }),
        ensureReady: async () => {},
      } as unknown as AgentsRepository,
      repo: { list: async () => [] } as unknown as SkillsRepository,
      agentSkillsRepo: {
        upsertSkill: async (...args: unknown[]) => upserts.push(args),
      } as unknown as AgentSkillsRepository,
      seedSources: [],
      owner: "owner-1",
      egressDenies: () => qaAgentDenies,
    } as unknown as SkillsServiceDeps);

    await expect(
      service.install({
        agentId: "agent-1",
        source: URL,
        name: "qi-profile-dam",
        version: SHA,
      }),
    ).rejects.toThrow(/Set a path on the skill source/);
    expect(upserts).toEqual([]);
  });
});
