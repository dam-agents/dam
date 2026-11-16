import {
  githubHostOf,
  type Connection,
  type Contribution,
} from "api-server-api";

// UNIT_BOUNDARY_DESCRIPTION: a GitHub Enterprise Connection names its host in three places: the GH_HOST env, the API host `api.<host>`, and the git host itself. Moving a Connection to another host rewrites exactly those, so the gateway injects its credential on the new host and nowhere on the old one.
export function rehostedContributions(
  contributions: readonly Contribution[],
  from: string,
  to: string,
): Contribution[] {
  const hostOf = (host: string): string =>
    host === from ? to : host === `api.${from}` ? `api.${to}` : host;
  return contributions.map((c) => {
    switch (c.kind) {
      case "env":
        return c.name === "GH_HOST" && c.placeholder === from
          ? { ...c, placeholder: to }
          : c;
      case "egress-allow":
      case "egress-inject":
      case "egress-sign":
        return { ...c, host: hostOf(c.host) };
      case "file":
      case "mcp-entry":
      case "skill-ref":
        return c;
    }
  });
}

export function connectionHostOf(conn: Connection): string | undefined {
  switch (conn.auth.kind) {
    case "oauth":
    case "github-app":
    case "client-credentials":
      return conn.auth.host;
    case "header":
      return githubHostOf(conn.contributions);
    case "sigv4":
    case "none":
      return undefined;
  }
}
