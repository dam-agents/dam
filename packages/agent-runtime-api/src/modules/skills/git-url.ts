export interface NormalizedGitUrl {
  gitUrl: string;
  path?: string;
  ref?: string;
}

export interface GithubRepo {
  owner: string;
  repo: string;
}

const BROWSE_MARKERS = ["tree", "blob"];

export function normalizeGitUrl(input: string): NormalizedGitUrl | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  const url = parseUrl(
    /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
  );
  if (!url) return null;
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  url.protocol = "https:";
  url.search = "";
  url.hash = "";
  if (url.hostname.length === 0) return null;

  const segments = url.pathname.split("/").filter((s) => s.length > 0);
  const browsed = splitBrowseUrl(segments);
  const repoSegments = stripRepoSuffix(
    url.hostname === "github.com"
      ? browsed.repoSegments.slice(0, 2)
      : browsed.repoSegments,
  );
  if (repoSegments.length < 2) return null;

  url.pathname = `/${repoSegments.join("/")}`;
  return {
    gitUrl: url.toString().replace(/\/$/, ""),
    ...(browsed.path !== undefined ? { path: browsed.path } : {}),
    ...(browsed.ref !== undefined ? { ref: browsed.ref } : {}),
  };
}

export function parseGithubRepo(gitUrl: string): GithubRepo | null {
  const normalized = normalizeGitUrl(gitUrl);
  if (!normalized) return null;
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(normalized.gitUrl);
  return m ? { owner: m[1], repo: m[2] } : null;
}

function parseUrl(candidate: string): URL | null {
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

interface BrowseSplit {
  repoSegments: string[];
  path?: string;
  ref?: string;
}

function splitBrowseUrl(segments: string[]): BrowseSplit {
  const marker = segments.findIndex(
    (s, i) => i >= 2 && BROWSE_MARKERS.includes(s),
  );
  if (marker === -1 || marker + 1 >= segments.length) {
    return { repoSegments: segments };
  }

  const before = segments.slice(0, marker);
  const rest = segments.slice(marker + 2);
  const dir = segments[marker] === "blob" ? rest.slice(0, -1) : rest;
  return {
    repoSegments:
      before[before.length - 1] === "-" ? before.slice(0, -1) : before,
    ...(dir.length > 0 ? { path: dir.join("/") } : {}),
    ref: segments[marker + 1],
  };
}

function stripRepoSuffix(segments: string[]): string[] {
  if (segments.length === 0) return segments;
  const last = segments[segments.length - 1].replace(/\.git$/, "");
  if (last.length === 0) return segments.slice(0, -1);
  return [...segments.slice(0, -1), last];
}
