export interface EnterpriseHost {
  host: string;
  token: string;
}

export interface GitHostRequest {
  url: string;
  headers: Record<string, string>;
}

export interface GitHostRepo {
  readonly host: string;
  readonly owner: string;
  readonly repo: string;
  readonly gitUrl: string;
  file(ref: string, segments: readonly string[]): GitHostRequest;
  refAdvertisement(): GitHostRequest;
}

export interface GitHosts {
  readonly readableHosts: readonly string[];
  locate(url: string): GitHostRepo | null;
}

const PUBLIC_HOST = "github.com";
const HOSTNAME =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function trimRepoUrl(url: string): string | null {
  if (url.includes("#")) return null;
  return url.replace(/\/+$/, "").replace(/\.git$/, "");
}

function ownerAndRepo(
  trimmed: string,
  host: string,
): { owner: string; repo: string } | null {
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^https://${escaped}/([^/]+)/([^/]+)$`).exec(
    trimmed,
  );
  return match ? { owner: match[1]!, repo: match[2]! } : null;
}

function encodeSegments(segments: readonly string[]): string {
  return segments.map((segment) => encodeURIComponent(segment)).join("/");
}

function publicRepo(owner: string, repo: string): GitHostRepo {
  const gitUrl = `https://${PUBLIC_HOST}/${owner}/${repo}`;
  return {
    host: PUBLIC_HOST,
    owner,
    repo,
    gitUrl,
    file(ref, segments) {
      return {
        url: `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${encodeSegments(segments)}`,
        headers: {},
      };
    },
    refAdvertisement() {
      return {
        url: `${gitUrl}/info/refs?service=git-upload-pack`,
        headers: {},
      };
    },
  };
}

function enterpriseRepo(
  enterprise: EnterpriseHost,
  owner: string,
  repo: string,
): GitHostRepo {
  const { host, token } = enterprise;
  const gitUrl = `https://${host}/${owner}/${repo}`;
  return {
    host,
    owner,
    repo,
    gitUrl,
    file(ref, segments) {
      return {
        url: `https://api.${host}/repos/${owner}/${repo}/contents/${encodeSegments(segments)}?ref=${encodeURIComponent(ref)}`,
        headers: {
          Accept: "application/vnd.github.raw",
          Authorization: `Bearer ${token}`,
        },
      };
    },
    refAdvertisement() {
      return {
        url: `${gitUrl}/info/refs?service=git-upload-pack`,
        headers: {
          Authorization: `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
        },
      };
    },
  };
}

function usableEnterprise(
  enterprise: EnterpriseHost | undefined,
): EnterpriseHost | undefined {
  const host = (enterprise?.host ?? "").trim().toLowerCase();
  const token = enterprise?.token ?? "";
  if (host === "" && token === "") return undefined;
  if (host === "")
    throw new Error(
      "an enterprise GitHub token is configured with no host to send it to: set github.enterprise.host, or clear github.enterprise.token",
    );
  if (host === PUBLIC_HOST)
    throw new Error(
      `github.enterprise.host is ${PUBLIC_HOST}, which is always read anonymously: name the enterprise host, or clear the setting`,
    );
  if (!HOSTNAME.test(host))
    throw new Error(
      `github.enterprise.host is not a hostname: ${host} (a bare host such as github.example.com, with no scheme or path)`,
    );
  if (token === "")
    throw new Error(
      `github.enterprise.host is ${host} but its token is empty: the catalogs and kits on that host would read as withdrawn and their kits would be pruned, so this install refuses to start instead`,
    );
  return { host, token };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The hosts a Kit Catalog and the kits it lists may
 * be read from, and how each one is reached. Public GitHub is read anonymously
 * over its raw-file endpoint, as it always was. An install that configures an
 * enterprise host reads that host through its own API with the install's token,
 * and sends the token to no other host: a URL naming any other host resolves to
 * nothing, so a typo in a catalog locator can never hand the credential out.
 * The refresh job reads catalogs with no user in context, which is why the
 * credential belongs to the install rather than to a user's Connection.
 */
export function createGitHosts(enterprise?: EnterpriseHost): GitHosts {
  const configured = usableEnterprise(enterprise);
  return {
    readableHosts: [PUBLIC_HOST, ...(configured ? [configured.host] : [])],
    locate(url) {
      const trimmed = trimRepoUrl(url);
      if (trimmed === null) return null;
      const onPublic = ownerAndRepo(trimmed, PUBLIC_HOST);
      if (onPublic) return publicRepo(onPublic.owner, onPublic.repo);
      if (!configured) return null;
      const onEnterprise = ownerAndRepo(trimmed, configured.host);
      return onEnterprise
        ? enterpriseRepo(configured, onEnterprise.owner, onEnterprise.repo)
        : null;
    },
  };
}

const PUBLIC_ONLY = createGitHosts();

/**
 * UNIT_BOUNDARY_DESCRIPTION: Which hosts one Kit Catalog's own entries and seeds
 * may name. An external catalog **moves** by design — whoever writes to it, and
 * not the operator, decides what it lists — so a catalog on public GitHub may
 * only point at public GitHub. The install's enterprise credential is reachable
 * from a catalog the operator put on that host, and from the catalog the chart
 * ships, because in both cases the operator chose what it lists. Without this,
 * an entry in any configured catalog would pick the internal repository the
 * refresh opens with the install's token, and publish what it read.
 */
export function catalogEntryHosts(
  all: GitHosts,
  catalogGitUrl: string | undefined,
): GitHosts {
  if (catalogGitUrl === undefined) return all;
  const host = all.locate(catalogGitUrl)?.host;
  return host !== undefined && host !== PUBLIC_HOST ? all : PUBLIC_ONLY;
}
