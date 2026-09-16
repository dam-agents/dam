// TEST_OVERVIEW: the Knowledge Bases form creates a knowledge base by applying the built-in starter kit that declares the picked template — the kit owns the marker, the install and the first session, and the form contributes only its choices. A template no kit declares is a NOT_FOUND, not a half-created agent.
import type {
  Agent,
  StarterKitApplyInput,
  StarterKitApplyResult,
} from "api-server-api";
import { describe, expect, it } from "vitest";

import { createKnowledgeBasesService } from "../../modules/knowledge-bases/services/knowledge-bases-service.js";

function makeHarness(
  known: Record<string, { catalog: string; kitId: string }>,
) {
  const applied: StarterKitApplyInput[] = [];
  const service = createKnowledgeBasesService({
    kitForTemplate: async (id) => known[id],
    applyKit: async (input): Promise<StarterKitApplyResult> => {
      applied.push(input);
      return {
        agent: { id: "agent-kb1", name: input.name } as Agent,
        skills: null,
        skillsError: null,
      };
    },
  });
  return { service, applied };
}

describe("knowledge-bases service", () => {
  it("applies the built-in kit that declares the picked template with the form's choices", async () => {
    const { service, applied } = makeHarness({
      "plain-wiki": { catalog: "platform", kitId: "plain-wiki" },
    });
    const agent = await service.create({
      name: "team wiki",
      templateId: "codex",
      connectionIds: ["c-provider"],
      kbTemplateId: "plain-wiki",
    });
    expect(agent.id).toBe("agent-kb1");
    expect(applied).toEqual([
      {
        catalog: "platform",
        kitId: "plain-wiki",
        name: "team wiki",
        templateId: "codex",
        connectionIds: ["c-provider"],
        skipSchedules: [],
        scheduleOverrides: [],
      },
    ]);
  });

  it("refuses a template no resolved kit declares", async () => {
    const { service, applied } = makeHarness({});
    await expect(
      service.create({
        name: "team wiki",
        templateId: "claude-code",
        kbTemplateId: "llm-wiki",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(applied).toEqual([]);
  });
});
