import { describe, it, expect, vi } from "vitest";
import type { Skill } from "api-server-api";
import type { AgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import type { AgentRuntimeSkillsClient } from "../../modules/skills/infrastructure/agent-runtime-client.js";
import { PublicArchiveNotFoundError } from "../../modules/skills/infrastructure/public-archive-scanner.js";
import type { SkillsRepository } from "../../modules/skills/infrastructure/skills-repository.js";
import {
  createSkillsService,
  type SkillsServiceDeps,
} from "../../modules/skills/services/skills-service.js";

const OWNER = "82f9ce4a-a551-4c0d-95e0-36aa9d7fb9ae";
const SOURCE_ID = "skill-src-1";
const GIT_URL = "https://github.com/acme/skills";
const AGENT_ID = "agent-1";

const skill: Skill = {
  source: GIT_URL,
  name: "a",
  description: "",
  version: "abc1234",
  contentHash: "hash-a",
  dir: "skills/a",
};

/** A service wired to spy on the scope each scan path asks the cache for.
 *  `scanSource` stands in for the cache: it runs the scanner it was handed,
 *  exactly as a cold cache would. */
function serviceWithScanSpy(scanPublic: SkillsServiceDeps["scanPublic"]) {
  const scanSource = vi.fn<SkillsServiceDeps["scanSource"]>(
    async (_scope, gitUrl, _path, scanner) => ({
      skills: await scanner(gitUrl),
      scannedAt: 1_000_000,
    }),
  );
  const deps = {
    repo: {
      get: async () => ({ id: SOURCE_ID, name: "acme", gitUrl: GIT_URL }),
    } as unknown as SkillsRepository,
    agentsRepo: {
      get: async () => ({ id: AGENT_ID, ready: true }),
      ensureReady: async () => {},
    } as unknown as AgentsRepository,
    runtimeClient: {
      scan: async () => [skill],
    } as unknown as AgentRuntimeSkillsClient,
    seedSources: [],
    owner: OWNER,
    scanSource,
    scanPublic,
  } as unknown as SkillsServiceDeps;
  return { service: createSkillsService(deps), scanSource };
}

describe("skills list scan scope", () => {
  it("scans a public source shared, so one read answers every user", async () => {
    const { service, scanSource } = serviceWithScanSpy(async () => [skill]);

    await service.list(SOURCE_ID, AGENT_ID);

    expect(scanSource).toHaveBeenCalledTimes(1);
    expect(scanSource.mock.calls[0][0]).toEqual({ kind: "shared" });
  });

  it("scans a private source under the scanning sandbox's own scope, never shared", async () => {
    const { service, scanSource } = serviceWithScanSpy(async () => {
      throw new PublicArchiveNotFoundError(GIT_URL);
    });

    await service.list(SOURCE_ID, AGENT_ID);

    // The public probe runs first and 404s; the pod scan that answers carried
    // one sandbox's credentials, so it is scoped to that sandbox — a sibling
    // with different grants must not be served this list.
    expect(scanSource).toHaveBeenCalledTimes(2);
    expect(scanSource.mock.calls[1][0]).toEqual({
      kind: "agent",
      owner: OWNER,
      agentId: AGENT_ID,
    });
  });
});
