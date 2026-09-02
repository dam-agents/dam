import { providerTypeForTemplateId } from "api-server-api";
import { describe, expect, test } from "vitest";

import {
  allFixtureAgents,
  bareAgent,
  errorAgent,
  fixtureSchedules,
  fullAgent,
  neverHibernatesButHibernated,
  neverHibernatesOverBudget,
  singularAgent,
} from "../../mock/data/agent-card-fixtures.js";
import {
  agentConnections,
  connections,
  connectionTemplates,
} from "../../mock/data/connections.js";
import type { AgentView } from "../../types.js";

const allConnections = [
  ...connections,
  ...agentConnections.filter((ac) => !connections.some((c) => c.id === ac.id)),
];

const CONNECTION_TEMPLATE_BY_ID = new Map(
  allConnections.map((c) => [c.id, c.templateId]),
);

const CONNECTION_NAME_BY_ID = new Map(
  allConnections.map((c) => [c.id, c.name]),
);

const ICON_SLUG_BY_TEMPLATE_ID = new Map(
  connectionTemplates.filter((t) => t.iconSlug).map((t) => [t.id, t.iconSlug]),
);

interface ConnectionBadgeInfo {
  name: string;
  iconSlug: string;
}

function nonProviderConnections(agent: AgentView): ConnectionBadgeInfo[] {
  const result: ConnectionBadgeInfo[] = [];
  for (const cid of agent.grantedConnectionIds) {
    const tid = CONNECTION_TEMPLATE_BY_ID.get(cid);
    if (tid && providerTypeForTemplateId(tid)) continue;
    const name = CONNECTION_NAME_BY_ID.get(cid);
    if (!name) continue;
    result.push({
      name,
      iconSlug: (tid && ICON_SLUG_BY_TEMPLATE_ID.get(tid)) ?? "",
    });
  }
  return result;
}

function slackChannelIds(agent: AgentView): string[] {
  return agent.channels
    .filter((c) => c.type === "slack")
    .map(
      (c) => (c as { type: "slack"; slackChannelId: string }).slackChannelId,
    );
}

function enabledScheduleCount(agent: AgentView): number {
  return fixtureSchedules.filter((s) => s.agentId === agent.id && s.enabled)
    .length;
}

function hasMeta(agent: AgentView): boolean {
  return (
    slackChannelIds(agent).length > 0 ||
    nonProviderConnections(agent).length > 0 ||
    enabledScheduleCount(agent) > 0
  );
}

describe("agent card design verification", () => {
  describe("slack channels shown as individual tags", () => {
    test("full agent has 2 slack channel tags", () => {
      const ids = slackChannelIds(fullAgent);
      expect(ids).toEqual(["#deployments", "#alerts"]);
    });

    test("singular agent has 1 slack channel tag", () => {
      const ids = slackChannelIds(singularAgent);
      expect(ids).toHaveLength(1);
    });

    test("bare agent has no slack channels", () => {
      expect(slackChannelIds(bareAgent)).toHaveLength(0);
    });
  });

  describe("connections with icons instead of counts", () => {
    test("full agent has named connections with icon slugs", () => {
      const conns = nonProviderConnections(fullAgent);
      expect(conns.length).toBeGreaterThan(0);
      expect(conns.every((c) => c.name.length > 0)).toBe(true);
      expect(conns.every((c) => typeof c.iconSlug === "string")).toBe(true);
    });

    test("full agent connections include github icon slug", () => {
      const conns = nonProviderConnections(fullAgent);
      expect(conns.some((c) => c.iconSlug === "github")).toBe(true);
    });

    test("bare agent has no non-provider connections", () => {
      expect(nonProviderConnections(bareAgent)).toHaveLength(0);
    });

    test("provider connections are excluded", () => {
      for (const agent of allFixtureAgents) {
        const conns = nonProviderConnections(agent);
        for (const c of conns) {
          expect(c.name).not.toMatch(/anthropic/i);
        }
      }
    });
  });

  describe("active schedules", () => {
    test("full agent has 3 active schedules", () => {
      expect(enabledScheduleCount(fullAgent)).toBe(3);
    });

    test("bare agent has 0 schedules", () => {
      expect(enabledScheduleCount(bareAgent)).toBe(0);
    });
  });

  describe("bare agent has no metadata row", () => {
    test("bare agent has no metadata", () => {
      expect(hasMeta(bareAgent)).toBe(false);
    });
  });

  describe("always-on badge for never-hibernating running agents", () => {
    test("always-on agents are identified by hibernationTimeoutMin === 0", () => {
      expect(fullAgent.hibernationTimeoutMin).toBe(0);
      expect(neverHibernatesButHibernated.hibernationTimeoutMin).toBe(0);
      expect(neverHibernatesOverBudget.hibernationTimeoutMin).toBe(0);
    });

    test("agents with positive timeout are not always-on", () => {
      expect(bareAgent.hibernationTimeoutMin).toBeGreaterThan(0);
      expect(singularAgent.hibernationTimeoutMin).toBeGreaterThan(0);
      expect(errorAgent.hibernationTimeoutMin).toBeGreaterThan(0);
    });
  });

  describe("fixture agents cover required states", () => {
    test("at least one running agent", () => {
      expect(allFixtureAgents.some((a) => a.state === "running")).toBe(true);
    });

    test("at least one hibernated agent", () => {
      expect(allFixtureAgents.some((a) => a.state === "hibernated")).toBe(true);
    });

    test("at least one error agent", () => {
      expect(allFixtureAgents.some((a) => a.state === "error")).toBe(true);
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
  });

  describe("schedule fixture data consistency", () => {
    test("all fixture schedules reference existing fixture agents", () => {
      const ids = new Set(allFixtureAgents.map((a) => a.id));
      for (const s of fixtureSchedules) {
        expect(ids.has(s.agentId)).toBe(true);
      }
    });
  });
});
