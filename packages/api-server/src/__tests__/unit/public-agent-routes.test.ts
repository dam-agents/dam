import { describe, expect, it } from "vitest";
import type { PublicAgentView } from "api-server-api";
import { createPublicAgentRoutes } from "../../modules/agents/infrastructure/public-agent-routes.js";
import type { PublicAgentPageService } from "../../modules/agents/services/public-agent-page-service.js";

/**
 * TEST_OVERVIEW: The public agent route is the only unauthenticated read of
 * agent data. A stranger arrives from a Slack link with no session, so the specs
 * pin what the wire tells them: a bound agent is named, and everything else
 * answers the same 200 with a null agent so the response never reveals which
 * agents exist.
 */

function routesWith(agents: Record<string, PublicAgentView>) {
  const service: PublicAgentPageService = {
    get: (agentId) => Promise.resolve(agents[agentId] ?? null),
  };
  return createPublicAgentRoutes({ service });
}

const ROUTES = routesWith({
  "agent-1": {
    agentId: "agent-1",
    name: "release-notes-bot",
    ownerName: "Radek Jezek",
  },
});

describe("public agent routes", () => {
  /**
   * TEST_SCENARIO: The page needs the agent's name and owner to render anything
   * useful, and it asks for them with no credential at all.
   */
  it("answers a bound agent with its name and owner", async () => {
    const res = await ROUTES.request("/agents/agent-1");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      agent: {
        agentId: "agent-1",
        name: "release-notes-bot",
        ownerName: "Radek Jezek",
      },
    });
  });

  /**
   * TEST_SCENARIO: Agent ids are unguessable, so a 404 here would turn the route
   * into a way to test whether an id exists. An unknown id, an unbound agent and
   * a deleted agent all reach this branch and must be indistinguishable.
   */
  it("answers 200 with a null agent for anything the service does not name", async () => {
    const res = await ROUTES.request("/agents/agent-0000000000000000");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ agent: null });
  });

  /**
   * TEST_SCENARIO: An agent can be renamed or deleted at any moment, and the
   * answer names a person. A cached copy in a shared proxy would outlive both.
   */
  it("tells caches not to store the answer", async () => {
    const res = await ROUTES.request("/agents/agent-1");

    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
