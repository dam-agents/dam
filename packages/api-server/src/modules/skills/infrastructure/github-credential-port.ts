import type { ConnectionsRepository } from "../../connections/index.js";

const GITHUB_API_HOST = "api.github.com";

export interface GithubCredentialPort {
  hasGithubApiCredential(agentId: string): Promise<boolean>;
}

export function createGithubCredentialPort(
  repo: ConnectionsRepository,
): GithubCredentialPort {
  return {
    async hasGithubApiCredential(agentId) {
      const connections = await repo.listConnectionsForAgent(agentId);
      return connections.some((c) =>
        c.contributions.some(
          (contribution) =>
            contribution.kind === "egress-inject" &&
            contribution.host === GITHUB_API_HOST,
        ),
      );
    },
  };
}
