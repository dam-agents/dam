import { Hono } from "hono";
import type { PublicAgentResponse } from "api-server-api";
import type { PublicAgentPageService } from "../services/public-agent-page-service.js";

export interface PublicAgentRoutesDeps {
  service: PublicAgentPageService;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The only unauthenticated read of agent data. It
 * exists as its own route file, outside the tRPC surface, because every tRPC
 * call carries a principal and this one has none: the reader arrives from a
 * Slack link with no session.
 *
 * `GET /:agentId` always answers 200. An unknown id, an agent with no channel
 * binding, and a deleted agent all return `{ agent: null }`, so the response
 * never confirms which agents exist. Mounted under `/api/public` so the
 * unauthenticated carve-out in the app's PUBLIC_PATHS is one prefix rather than
 * a hole inside `/api/agents/*`.
 */
export function createPublicAgentRoutes(deps: PublicAgentRoutesDeps): Hono {
  const routes = new Hono();

  routes.get("/agents/:agentId", async (c) => {
    const agent = await deps.service.get(c.req.param("agentId"));
    c.header("Cache-Control", "no-store");
    return c.json({ agent } satisfies PublicAgentResponse);
  });

  return routes;
}
