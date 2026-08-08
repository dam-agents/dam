import type { ConnectionsRepository } from "../../connections/index.js";

/** The GitHub REST host every skills scan talks to. A connection that injects
 *  a credential for it is what turns an anonymous scan into an authenticated
 *  one; a GitHub Enterprise connection covers a different host, which is
 *  correct — it cannot read a `github.com` source either. */
const GITHUB_API_HOST = "api.github.com";

export interface GithubCredentialPort {
  /** Whether this sandbox's granted connections inject a credential for
   *  api.github.com — the only thing that lets a private-source scan
   *  authenticate. False means no connection can reach a private repo, however
   *  the grant is configured. */
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
