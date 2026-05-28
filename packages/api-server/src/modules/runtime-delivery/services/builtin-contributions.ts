import type { Contribution } from "api-server-api";

export interface BuiltinContributions {
  for(agentId: string): Contribution[];
}

export interface BuiltinContributionsOpts {
  /** URL of the api-server harness Service that the paired gateway
   *  pod's Envoy is configured to passthrough. Used to render the
   *  per-agent `platform-outbound` MCP entry. Sourced from
   *  `PLATFORM_HARNESS_SERVER_URL`, matching the controller. */
  harnessServerUrl: string;
}

/**
 * Always-on contributions injected into every applyState payload, on top
 * of user-granted Connection contributions and installed Skills.
 *
 * Today: a single `platform-outbound` MCP server pointing at the agent's
 * own harness MCP endpoint. No Authorization header — harness traffic
 * rides the paired gateway pod's mesh identity (ADR-041), and the
 * waypoint AuthorizationPolicy enforces principal == URL :id.
 */
export function createBuiltinContributions(
  opts: BuiltinContributionsOpts,
): BuiltinContributions {
  const base = opts.harnessServerUrl.replace(/\/+$/, "");
  return {
    for(agentId: string): Contribution[] {
      return [
        {
          kind: "mcp-entry",
          name: "platform-outbound",
          url: `${base}/api/agents/${encodeURIComponent(agentId)}/mcp`,
        },
      ];
    },
  };
}
