import { detectHost } from "./git-host.js";

export interface PrCoordinates {
  owner: string;
  repo: string;
  number: number;
}

/**
 * `https://github.com/{owner}/{repo}/pull/{n}` → its parts, or null when the
 * URL is not a GitHub pull request (an enterprise host, a moved repo, junk).
 *
 * A URL that does not parse is not an error — the record simply stays
 * unresolved and its badge says so.
 */
export function parsePrUrl(prUrl: string): PrCoordinates | null {
  const m = /^(.*)\/pull\/(\d+)$/.exec(prUrl.replace(/\/+$/, ""));
  if (!m) return null;
  // Host recognition stays in detectHost so there is one answer to "is this
  // GitHub", shared with publish and the public scan.
  const host = detectHost(m[1]);
  if (!host) return null;
  return { owner: host.owner, repo: host.repo, number: Number(m[2]) };
}
