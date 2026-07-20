/** Frontend git-source URL helpers. The UI only ever needs to *display* a repo
 *  and link to its blob/compare web views — it never calls a git host — so this
 *  is deliberately a light mirror of the backend's `detectHost`, not a port. */

/** Strip scheme and any trailing `.git`/slash so a repo URL reads as
 *  `host/org/repo`. */
export function repoSlug(gitUrl: string): string {
  return gitUrl
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .replace(/\.git$/, "");
}

/** `host/org/repo` → `org/repo`, for a compact source label. */
export function orgRepo(gitUrl: string): string {
  return repoSlug(gitUrl).replace(/^[^/]+\//, "");
}

/** The hosts whose web UI exposes `/blob` and `/compare` views (matches
 *  enterprise variants like `github.ibm.com` by substring). */
export function isKnownGitHost(gitUrl: string): boolean {
  return /(github|gitlab|bitbucket)/i.test(gitUrl);
}

/** Web URL to a file at a ref, or null for an unrecognized host. */
export function gitBlobUrl(
  gitUrl: string,
  ref: string,
  filePath: string,
): string | null {
  if (!isKnownGitHost(gitUrl)) return null;
  return `https://${repoSlug(gitUrl)}/blob/${ref}/${filePath}`;
}

/** Web compare view between two refs, or null for an unrecognized host. */
export function gitCompareUrl(
  gitUrl: string,
  from: string,
  to: string,
): string | null {
  if (!isKnownGitHost(gitUrl)) return null;
  return `https://${repoSlug(gitUrl)}/compare/${from}...${to}`;
}
