/**
 * Client-side grouping for the GitHub-PAT picker. A single PAT is stored
 * server-side as two `generic` secrets sharing a `name` — one for
 * `api.github.com` (Bearer / `gh` CLI / `GH_TOKEN` env), one for
 * `github.com` (Basic / `git clone`). See spec's two-secret rationale.
 *
 * For the picker to display one row per PAT, we filter to those two
 * hosts, group by name, and keep only groups where both halves exist.
 * Orphans (one host only, or duplicates on the same host) are dropped
 * — surfacing partial pairs would let users pick a "PAT" that can't
 * actually fulfil `setAgentAccess`'s contract.
 */

export interface SecretLike {
  id: string;
  name: string;
  type: string;
  hostPattern: string;
}

export interface GithubPatPair {
  name: string;
  /** Host = `api.github.com`. Bearer injection + `GH_TOKEN` env. */
  apiSecretId: string;
  /** Host = `github.com`. Basic injection. */
  gitSecretId: string;
}

const API_HOST = "api.github.com";
const GIT_HOST = "github.com";

export function groupGithubPats(
  secrets: readonly SecretLike[],
): GithubPatPair[] {
  const byName = new Map<string, { api: string[]; git: string[] }>();
  for (const s of secrets) {
    const slot =
      s.hostPattern === API_HOST
        ? "api"
        : s.hostPattern === GIT_HOST
          ? "git"
          : null;
    if (!slot) continue;
    let group = byName.get(s.name);
    if (!group) {
      group = { api: [], git: [] };
      byName.set(s.name, group);
    }
    group[slot].push(s.id);
  }

  const pairs: GithubPatPair[] = [];
  for (const [name, group] of byName) {
    if (group.api.length === 1 && group.git.length === 1) {
      pairs.push({
        name,
        apiSecretId: group.api[0]!,
        gitSecretId: group.git[0]!,
      });
    }
  }
  pairs.sort((a, b) => a.name.localeCompare(b.name));
  return pairs;
}
