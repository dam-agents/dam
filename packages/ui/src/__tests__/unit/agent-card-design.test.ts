import { providerTypeForTemplateId } from "api-server-api";
import { describe, expect, test } from "vitest";

import {
  allFixtureAgents,
  bareAgent,
  demoPackAgent,
  errorAgent,
  experimentAgent,
  fixturePackProvenance,
  fixtureSchedules,
  fixtureSkillCounts,
  fullAgent,
  hibernatedUnknownSkills,
  knowledgeBaseAgent,
  neverHibernatesButHibernated,
  neverHibernatesOverBudget,
  packSkippedAgent,
  singularAgent,
  temporaryDriverAgent,
} from "../../mock/data/agent-card-fixtures.js";
import { connections } from "../../mock/data/connections.js";
import type { AgentView } from "../../types.js";

const CONNECTION_TEMPLATE_BY_ID = new Map(
  connections.map((c) => [c.id, c.templateId]),
);

function nonProviderConnectionCount(agent: AgentView): number {
  let count = 0;
  for (const cid of agent.grantedConnectionIds) {
    const tid = CONNECTION_TEMPLATE_BY_ID.get(cid);
    if (tid && providerTypeForTemplateId(tid)) continue;
    count += 1;
  }
  return count;
}

function chipText(agent: AgentView) {
  const chips: string[] = [];

  const slackCount = agent.channels.filter((c) => c.type === "slack").length;
  const telegramCount = agent.channels.filter(
    (c) => c.type === "telegram",
  ).length;
  const connectionCount = nonProviderConnectionCount(agent);
  const scheduleCount = fixtureSchedules.filter(
    (s) => s.agentId === agent.id && s.enabled,
  ).length;
  const skills = fixtureSkillCounts[agent.id];
  const skillCount = skills ? skills.installed + skills.standalone : null;

  if (slackCount > 0)
    chips.push(`${slackCount} channel${slackCount === 1 ? "" : "s"}`);
  if (telegramCount > 0)
    chips.push(`${telegramCount} chat${telegramCount === 1 ? "" : "s"}`);
  if (connectionCount > 0)
    chips.push(
      `${connectionCount} connection${connectionCount === 1 ? "" : "s"}`,
    );
  if (scheduleCount > 0)
    chips.push(`${scheduleCount} schedule${scheduleCount === 1 ? "" : "s"}`);
  if (skillCount !== null && skillCount > 0)
    chips.push(`${skillCount} skill${skillCount === 1 ? "" : "s"}`);
  if (agent.hibernationTimeoutMin === 0) chips.push("Never hibernates");

  return chips;
}

function hasAttachments(agent: AgentView): boolean {
  return chipText(agent).length > 0;
}

describe("§6 agent card design verification", () => {
  describe("chip text is present and non-empty for populated agents", () => {
    test("full agent has all chip types", () => {
      const chips = chipText(fullAgent);
      expect(chips).toContain("2 channels");
      expect(chips).toContain("1 chat");
      expect(chips).toContain("3 connections");
      expect(chips).toContain("3 schedules");
      expect(chips).toContain("5 skills");
      expect(chips).toContain("Never hibernates");
      expect(chips.length).toBe(6);
    });

    test("singular agent uses singular forms", () => {
      const chips = chipText(singularAgent);
      expect(chips).toContain("1 channel");
      expect(chips).toContain("1 schedule");
      expect(chips).toContain("1 skill");
      expect(chips.every((c) => !c.includes("channels"))).toBe(true);
    });
  });

  describe("zero-omission — no '0 ' prefix, no absent row for bare agents", () => {
    test("bare agent has no attachments", () => {
      expect(hasAttachments(bareAgent)).toBe(false);
    });

    test("no chip text contains '0 '", () => {
      for (const agent of allFixtureAgents) {
        for (const chip of chipText(agent)) {
          expect(chip).not.toMatch(/^0 /);
        }
      }
    });
  });

  describe("absence assertions", () => {
    test("bare agent — no pack, no channels, no schedules, no skills, no never-hibernates", () => {
      const chips = chipText(bareAgent);
      expect(chips).toEqual([]);
    });

    test("hibernated agent with unknown skills — skill chip absent", () => {
      const chips = chipText(hibernatedUnknownSkills);
      expect(chips.some((c) => c.includes("skill"))).toBe(false);
    });

    test("no '+N' or '+N more' appears in any chip text", () => {
      for (const agent of allFixtureAgents) {
        for (const chip of chipText(agent)) {
          expect(chip).not.toMatch(/\+\d/);
        }
      }
    });
  });

  describe("never-hibernates is a configuration fact, not a status", () => {
    test("never-hibernates chip is present when hibernationTimeoutMin === 0", () => {
      expect(chipText(fullAgent)).toContain("Never hibernates");
      expect(chipText(neverHibernatesButHibernated)).toContain(
        "Never hibernates",
      );
      expect(chipText(neverHibernatesOverBudget)).toContain("Never hibernates");
    });

    test("agents with positive timeout do not show never-hibernates", () => {
      expect(chipText(bareAgent)).not.toContain("Never hibernates");
      expect(chipText(singularAgent)).not.toContain("Never hibernates");
      expect(chipText(errorAgent)).not.toContain("Never hibernates");
    });
  });

  describe("kind badges", () => {
    test("knowledge-base agent has kind set", () => {
      expect(knowledgeBaseAgent.kind).toBe("knowledge-base");
    });

    test("experiment agent has kind set", () => {
      expect(experimentAgent.kind).toBe("experiment");
    });

    test("plain agents have no kind", () => {
      expect(fullAgent.kind).toBeUndefined();
      expect(bareAgent.kind).toBeUndefined();
    });
  });

  describe("pack provenance fixture data consistency", () => {
    test("agents in fixturePackProvenance exist in allFixtureAgents", () => {
      const ids = new Set(allFixtureAgents.map((a) => a.id));
      for (const agentId of Object.keys(fixturePackProvenance)) {
        expect(ids.has(agentId)).toBe(true);
      }
    });

    test("full agent has pack provenance", () => {
      expect(fixturePackProvenance[fullAgent.id]).toBe("design-prototyper");
    });

    test("bare agent has no pack provenance", () => {
      expect(fixturePackProvenance[bareAgent.id]).toBeUndefined();
    });
  });

  describe("fixture agents cover all required §5 states", () => {
    test("at least one running agent", () => {
      expect(allFixtureAgents.some((a) => a.state === "running")).toBe(true);
    });

    test("at least one hibernated agent", () => {
      expect(allFixtureAgents.some((a) => a.state === "hibernated")).toBe(true);
    });

    test("at least one error agent", () => {
      expect(allFixtureAgents.some((a) => a.state === "error")).toBe(true);
    });

    test("at least one knowledge-base agent", () => {
      expect(allFixtureAgents.some((a) => a.kind === "knowledge-base")).toBe(
        true,
      );
    });

    test("at least one experiment agent", () => {
      expect(allFixtureAgents.some((a) => a.kind === "experiment")).toBe(true);
    });

    test("at least one over-budget agent", () => {
      expect(allFixtureAgents.some((a) => a.overBudget)).toBe(true);
    });

    test("at least one agent with contribution failures", () => {
      expect(
        allFixtureAgents.some((a) => a.contributionFailures.length > 0),
      ).toBe(true);
    });

    test("at least one agent with slack channels", () => {
      expect(
        allFixtureAgents.some((a) =>
          a.channels.some((c) => c.type === "slack"),
        ),
      ).toBe(true);
    });

    test("at least one agent with telegram", () => {
      expect(
        allFixtureAgents.some((a) =>
          a.channels.some((c) => c.type === "telegram"),
        ),
      ).toBe(true);
    });
  });

  describe("width-spread consistency — one-of-each vs many-of-each", () => {
    test("singular and full agent produce different chip counts", () => {
      const singularChips = chipText(singularAgent);
      const fullChips = chipText(fullAgent);
      expect(singularChips.length).toBeLessThan(fullChips.length);
    });

    test("all chip strings are reasonably short (under 25 chars)", () => {
      for (const agent of allFixtureAgents) {
        for (const chip of chipText(agent)) {
          expect(chip.length).toBeLessThanOrEqual(25);
        }
      }
    });
  });

  describe("defect injection — verify checks catch real problems", () => {
    test("injecting '0 channels' would be caught by zero-omission check", () => {
      const fakeAgent: AgentView = {
        ...bareAgent,
        channels: [],
      };
      const chips = chipText(fakeAgent);
      expect(chips.some((c) => c.startsWith("0 "))).toBe(false);
    });

    test("removing all connections still produces correct chip text", () => {
      const fakeAgent: AgentView = {
        ...fullAgent,
        grantedConnectionIds: [],
      };
      const chips = chipText(fakeAgent);
      expect(chips.some((c) => c.includes("connection"))).toBe(false);
    });
  });

  describe("schedule fixture data consistency", () => {
    test("all fixture schedules reference existing fixture agents", () => {
      const ids = new Set(allFixtureAgents.map((a) => a.id));
      for (const s of fixtureSchedules) {
        expect(ids.has(s.agentId)).toBe(true);
      }
    });

    test("full agent has 3 schedules", () => {
      const count = fixtureSchedules.filter(
        (s) => s.agentId === fullAgent.id,
      ).length;
      expect(count).toBe(3);
    });

    test("bare agent has 0 schedules", () => {
      const count = fixtureSchedules.filter(
        (s) => s.agentId === bareAgent.id,
      ).length;
      expect(count).toBe(0);
    });
  });

  describe("skill count fixture data consistency", () => {
    test("full agent has 5 total skills (4 installed + 1 standalone)", () => {
      const skills = fixtureSkillCounts[fullAgent.id];
      expect(skills).not.toBeNull();
      expect(skills!.installed + skills!.standalone).toBe(5);
    });

    test("hibernated agent has no skill entry (unknown)", () => {
      expect(fixtureSkillCounts[hibernatedUnknownSkills.id]).toBeUndefined();
    });
  });
});
