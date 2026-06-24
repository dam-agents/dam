import type { Contribution } from "api-server-api";

export interface BuiltinContributions {
  for(agentId: string): Contribution[];
}

export interface BuiltinContributionsOpts {
  harnessServerUrl: string;
}

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
        {
          kind: "mcp-entry",
          name: "platform-keep-awake",
          url: "http://localhost:8080/api/mcp/keep-awake",
        },
      ];
    },
  };
}
