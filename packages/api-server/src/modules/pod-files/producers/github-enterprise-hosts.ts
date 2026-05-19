import type { FileFragment, FileProducer, FileSpec } from "../types.js";

/**
 * One row of the api-server's `/api/connections` response — only the
 * fields this producer needs. Kept local to avoid pulling the connections
 * module's port shape into the pod-files layer.
 */
interface RawConnection {
  id?: string;
  provider: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * Where the producer reads its state from. Agent-scoped: the callback
 * returns only the connections **granted to `agentId`** under `owner`,
 * not every connection the owner has registered. This matches the user-
 * facing model — the UI's per-agent grant click is the sole driver of
 * what files appear inside that agent's pod.
 *
 * `agentHome` is the HOME inside the agent container (helm `agentHome` /
 * `AGENT_HOME` env). Must agree with the controller's mount path; both
 * read the same chart value so they stay in sync.
 */
export interface GithubEnterpriseHostsDeps {
  fetchAgentGrantedConnections(
    owner: string,
    agentId: string,
  ): Promise<RawConnection[]>;
  agentHome: string;
}

export const GH_ENTERPRISE_HOSTS_RELATIVE_PATH = ".config/gh/hosts.yml";

/**
 * Strip scheme and port from `metadata.baseUrl` so the host can be matched
 * against Envoy's SNI filter chains.
 */
function extractHost(
  metadata: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!metadata) return undefined;
  const raw = metadata["baseUrl"];
  if (typeof raw !== "string") return undefined;
  const noScheme = raw.startsWith("https://")
    ? raw.slice("https://".length)
    : raw;
  const host = noScheme.split(":")[0]?.split("/")[0];
  return host && host.length > 0 ? host : undefined;
}

/**
 * `gh auth status` only displays the user — actual auth uses the sentinel
 * token (rewritten on the wire by the Envoy sidecar's credential_injector
 * filter). Pick the OAuth login (`metadata.username`) by default and fall
 * back through `login` and `name` so older records keep working.
 */
function pickUsername(
  metadata: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!metadata) return undefined;
  for (const key of ["username", "login", "name"]) {
    const v = metadata[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

function renderHostFragment(connection: RawConnection): FileFragment | null {
  const host = extractHost(connection.metadata);
  if (!host) {
    console.warn(
      `github-enterprise connection ${connection.id ?? "?"}: missing or malformed metadata.baseUrl; skipped`,
    );
    return null;
  }
  const username = pickUsername(connection.metadata);
  // Match gh's canonical multi-account shape directly so the first
  // auth-aware command (e.g. `gh auth status`) doesn't rewrite the file
  // by adding a `users.<login>` block. The `users` map is dropped when
  // username is unknown — gh tolerates the minimal form on read.
  return {
    [host]: {
      oauth_token: "dummy-placeholder",
      git_protocol: "https",
      ...(username
        ? {
            user: username,
            users: { [username]: { oauth_token: "dummy-placeholder" } },
          }
        : {}),
    },
  };
}

/**
 * Uses `yaml-fill-if-missing` so revokes are safe (entries linger but the
 * Envoy sidecar stops rewriting the sentinel once the grant is gone, so
 * the next call fails loud rather than silently using a stale grant).
 * Trade-off: a revoked host stays visible in `gh auth status` until the
 * user manually edits hosts.yml.
 */
export function makeGithubEnterpriseHostsProducer(
  deps: GithubEnterpriseHostsDeps,
): FileProducer {
  const path = `${deps.agentHome}/${GH_ENTERPRISE_HOSTS_RELATIVE_PATH}`;
  return {
    id: "github-enterprise:hosts",
    source: "app-connections",
    async produce(owner, agentId): Promise<FileSpec[]> {
      const granted = await deps.fetchAgentGrantedConnections(owner, agentId);
      const fragments = granted
        .filter((c) => c.provider === "github-enterprise")
        .map(renderHostFragment)
        .filter((f): f is FileFragment => f !== null);
      if (fragments.length === 0) return [];
      return [
        {
          path,
          mode: "yaml-fill-if-missing",
          fragments,
        },
      ];
    },
  };
}
