// TEST_OVERVIEW: A Skill Source is its repository and its path, so one repository can be connected several times; an install records the path of the source it came from, and deleting one source removes only the skills installed from its path.
import { describe, expect, it } from "vitest";
import type { SkillSource } from "api-server-api";
import type { AgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import type { AgentSkillsRepository } from "../../modules/skills/infrastructure/agent-skills-repository.js";
import type { SkillsRepository } from "../../modules/skills/infrastructure/skills-repository.js";
import {
  createSkillsService,
  type SkillsServiceDeps,
} from "../../modules/skills/services/skills-service.js";

const URL = "https://github.com/dam-agents/dam";
const SHA = "0123456789abcdef0123456789abcdef01234567";

function service(
  sources: SkillSource[],
  installed: {
    source: string;
    name: string;
    version: string;
    path?: string;
  }[] = [],
) {
  const upserts: { path?: string }[] = [];
  const removed: unknown[][] = [];
  const svc = createSkillsService({
    agentsRepo: {
      get: async () => ({ id: "agent-1", ready: true }),
      ensureReady: async () => {},
      list: async () => [{ id: "agent-1" }],
    } as unknown as AgentsRepository,
    repo: {
      list: async () => sources,
      get: async (id: string) => sources.find((s) => s.id === id) ?? null,
      delete: async () => {},
    } as unknown as SkillsRepository,
    agentSkillsRepo: {
      upsertSkill: async (_agentId: string, ref: { path?: string }) => {
        upserts.push(ref);
      },
      listSkills: async () => installed,
      removeBySource: async (...args: unknown[]) => {
        removed.push(args);
      },
    } as unknown as AgentSkillsRepository,
    runtimeMutator: {
      bump: async () => {},
      enqueueAfterCommit: async () => {},
    },
    unitOfWork: async (fn: (tx: unknown) => Promise<void>) => fn({}),
    seedSources: [],
    owner: "owner-1",
    surface: "test",
    egressDenies: () => async () => false,
  } as unknown as SkillsServiceDeps);
  return { svc, upserts, removed };
}

const install = (svc: ReturnType<typeof service>["svc"], path?: string) =>
  svc.install({
    agentId: "agent-1",
    source: URL,
    name: "qi-profile-dam",
    version: SHA,
    ...(path !== undefined ? { path } : {}),
  });

describe("one repository connected with several paths", () => {
  // TEST_SCENARIO: the product repository is connected for its developer skills and again with path qa for the QA profile; installing from the qa source records qa, and an install that names no path takes the path-less source.
  it("records the path of the source the install names", async () => {
    const { svc, upserts } = service([
      { id: "dev", name: "dev", gitUrl: URL },
      { id: "qa", name: "qa", gitUrl: URL, path: "qa" },
    ]);
    await install(svc, "qa");
    await install(svc);
    expect(upserts.map((r) => r.path)).toEqual(["qa", undefined]);
  });

  // TEST_SCENARIO: with two paths of one repository and no path-less source, an install that names no path cannot tell which source is meant, so it is refused rather than recorded against a guessed path.
  it("refuses an install that names no path when two paths could match", async () => {
    const { svc, upserts } = service([
      { id: "dev", name: "dev", gitUrl: URL, path: ".agents/skills" },
      { id: "qa", name: "qa", gitUrl: URL, path: "qa" },
    ]);
    await expect(install(svc)).rejects.toThrow(/several paths/);
    expect(upserts).toEqual([]);
  });

  // TEST_SCENARIO: an update from a client that sends no path, such as an older CLI or the MCP tool, keeps the path the skill was installed from instead of being refused or moved to another source of the repository.
  it("keeps the installed path when an update names no path", async () => {
    const { svc, upserts } = service(
      [
        { id: "dev", name: "dev", gitUrl: URL, path: ".agents/skills" },
        { id: "qa", name: "qa", gitUrl: URL, path: "qa" },
      ],
      [{ source: URL, name: "qi-profile-dam", version: "old", path: "qa" }],
    );
    await install(svc);
    expect(upserts.map((r) => r.path)).toEqual(["qa"]);
  });

  // TEST_SCENARIO: deleting the qa source must not uninstall the skills installed from the repository's other source.
  it("deletes only the skills installed from the deleted source's path", async () => {
    const { svc, removed } = service([
      { id: "dev", name: "dev", gitUrl: URL },
      { id: "qa", name: "qa", gitUrl: URL, path: "qa" },
    ]);
    await svc.deleteSource("qa");
    expect(removed).toEqual([[["agent-1"], URL, "qa"]]);
  });
});
