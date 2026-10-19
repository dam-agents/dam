// TEST_OVERVIEW: An owner can hide a Skill Source on one agent; the hide is keyed by the source's repository and path, so the agent's source list marks it hidden while other paths of the repository stay visible.
import { describe, expect, it } from "vitest";
import type { SkillSource } from "api-server-api";
import type { AgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import type {
  AgentSkillsRepository,
  HiddenSourceKey,
} from "../../modules/skills/infrastructure/agent-skills-repository.js";
import type { SkillsRepository } from "../../modules/skills/infrastructure/skills-repository.js";
import {
  createSkillsService,
  type SkillsServiceDeps,
} from "../../modules/skills/services/skills-service.js";

const URL = "https://github.com/dam-agents/dam";

function service(
  sources: SkillSource[],
  installed: { source: string; name: string; path?: string }[] = [],
) {
  const hidden: HiddenSourceKey[] = [];
  const svc = createSkillsService({
    agentsRepo: {
      get: async (id: string) => (id === "agent-1" ? { id } : null),
    } as unknown as AgentsRepository,
    repo: {
      list: async () => sources,
      get: async (id: string) => sources.find((s) => s.id === id) ?? null,
    } as unknown as SkillsRepository,
    agentSkillsRepo: {
      listHiddenSources: async () => hidden,
      listSkills: async () => installed,
      setSourceHidden: async (
        _agentId: string,
        key: HiddenSourceKey,
        on: boolean,
      ) => {
        if (on) hidden.push(key);
      },
    } as unknown as AgentSkillsRepository,
    seedSources: [],
    owner: "owner-1",
    surface: "test",
  } as unknown as SkillsServiceDeps);
  return { svc, hidden };
}

describe("hiding a skill source for one agent", () => {
  // TEST_SCENARIO: hiding the qa source of a repository connected twice marks only that source hidden in the agent's list.
  it("marks only the hidden path of the repository", async () => {
    const { svc, hidden } = service([
      { id: "dev", name: "dev", gitUrl: URL },
      { id: "qa", name: "qa", gitUrl: URL, path: "/qa/" },
    ]);
    await svc.setSourceHidden({ agentId: "agent-1", id: "qa", hidden: true });
    expect(hidden).toEqual([{ gitUrl: URL, path: "qa" }]);
    const listed = await svc.listSources("agent-1");
    expect(listed.map((s) => [s.id, s.hidden ?? false])).toEqual([
      ["dev", false],
      ["qa", true],
    ]);
  });

  // TEST_SCENARIO: a source whose skills are on the agent cannot be hidden, whether or not its scan works, so no skill stays on the agent without a toggle.
  it("refuses to hide a source with skills on the agent", async () => {
    const { svc, hidden } = service(
      [{ id: "qa", name: "qa", gitUrl: URL, path: "qa" }],
      [{ source: URL, name: "qi-profile", path: "qa" }],
    );
    await expect(
      svc.setSourceHidden({ agentId: "agent-1", id: "qa", hidden: true }),
    ).rejects.toThrow(/turn off/);
    expect(hidden).toEqual([]);
  });

  // TEST_SCENARIO: an owner cannot hide a source on an agent they do not own.
  it("refuses an agent the owner does not own", async () => {
    const { svc, hidden } = service([{ id: "dev", name: "dev", gitUrl: URL }]);
    await expect(
      svc.setSourceHidden({ agentId: "agent-2", id: "dev", hidden: true }),
    ).rejects.toThrow(/agent not found/);
    expect(hidden).toEqual([]);
  });
});
