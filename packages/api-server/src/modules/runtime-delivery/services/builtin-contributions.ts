import { SHARED_KB_TEMPLATE_ID, type Contribution } from "api-server-api";

export const KB_AGGREGATE_MCP_ENTRY_NAME = "knowledge-bases";
export { SHARED_KB_TEMPLATE_ID };

export interface BuiltinContributionOpts {
  sharedKnowledgeBases: boolean;
}

export interface BuiltinContributions {
  for(agentId: string, opts: BuiltinContributionOpts): Contribution[];
}

export interface BuiltinContributionsOpts {
  harnessServerUrl: string;
}

export function createBuiltinContributions(
  opts: BuiltinContributionsOpts,
): BuiltinContributions {
  const base = opts.harnessServerUrl.replace(/\/+$/, "");
  return {
    for(agentId, contributionOpts): Contribution[] {
      const agentPath = `${base}/api/agents/${encodeURIComponent(agentId)}`;
      return [
        {
          kind: "mcp-entry",
          name: "platform-outbound",
          url: `${agentPath}/mcp`,
        },
        ...(contributionOpts.sharedKnowledgeBases
          ? [
              {
                kind: "mcp-entry",
                name: KB_AGGREGATE_MCP_ENTRY_NAME,
                url: `${agentPath}/kb`,
              } satisfies Contribution,
            ]
          : []),
      ];
    },
  };
}
