import {
  KB_AGGREGATE_MCP_SERVER,
  PLATFORM_OUTBOUND_MCP_SERVER,
  type Contribution,
  type EnvVar,
} from "api-server-api";

export const AGENT_NAME_ENV = "PLATFORM_AGENT_NAME";
// UNIT_BOUNDARY_DESCRIPTION: set to 1 in the machine of an agent whose Web search control is on. A harness reads it to skip its own question about a web search, because the gateway asks the owner for every search of such an agent.
export const WEB_SEARCH_CONTROL_ENV = "PLATFORM_WEB_SEARCH_CONTROL";

export interface BuiltinContributions {
  for(
    agentId: string,
    opts: {
      agentName: string | null;
      webSearchControl: boolean;
      sharedKnowledgeBases: boolean;
      harnesses: readonly string[];
    },
  ): Contribution[];
}

export function createBuiltinContributions(opts: {
  harnessServerUrl: string;
  telemetryEnv: (harness: string) => readonly EnvVar[];
}): BuiltinContributions {
  const base = opts.harnessServerUrl.replace(/\/+$/, "");
  return {
    for(agentId, contributionOpts): Contribution[] {
      const agentPath = `${base}/api/agents/${encodeURIComponent(agentId)}`;
      return [
        {
          kind: "mcp-entry",
          name: PLATFORM_OUTBOUND_MCP_SERVER,
          url: `${agentPath}/mcp`,
        },
        ...(contributionOpts.agentName !== null
          ? [
              {
                kind: "env",
                name: AGENT_NAME_ENV,
                placeholder: contributionOpts.agentName,
              } satisfies Contribution,
            ]
          : []),
        ...(contributionOpts.webSearchControl
          ? [
              {
                kind: "env",
                name: WEB_SEARCH_CONTROL_ENV,
                placeholder: "1",
              } satisfies Contribution,
            ]
          : []),
        ...(contributionOpts.sharedKnowledgeBases
          ? [
              {
                kind: "mcp-entry",
                name: KB_AGGREGATE_MCP_SERVER,
                url: `${agentPath}/kb`,
              } satisfies Contribution,
            ]
          : []),
        ...contributionOpts.harnesses.flatMap((harness) =>
          opts.telemetryEnv(harness).map((e): Contribution => ({
            kind: "env",
            name: e.name,
            placeholder: e.value,
            harness,
          })),
        ),
      ];
    },
  };
}
