import {
  KB_AGGREGATE_MCP_SERVER,
  PLATFORM_OUTBOUND_MCP_SERVER,
  type Contribution,
} from "api-server-api";

export interface BuiltinContributions {
  for(agentId: string, opts: { sharedKnowledgeBases: boolean }): Contribution[];
}

export function createBuiltinContributions(opts: {
  harnessServerUrl: string;
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
        ...(contributionOpts.sharedKnowledgeBases
          ? [
              {
                kind: "mcp-entry",
                name: KB_AGGREGATE_MCP_SERVER,
                url: `${agentPath}/kb`,
              } satisfies Contribution,
            ]
          : []),
      ];
    },
  };
}
