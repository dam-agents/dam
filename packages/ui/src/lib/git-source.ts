export function repoSlug(gitUrl: string): string {
  return gitUrl
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .replace(/\.git$/, "");
}

export function orgRepo(gitUrl: string): string {
  return repoSlug(gitUrl).replace(/^[^/]+\//, "");
}

export function isKnownGitHost(gitUrl: string): boolean {
  return /(github|gitlab|bitbucket)/i.test(gitUrl);
}

export function gitBlobUrl(
  gitUrl: string,
  ref: string,
  filePath: string,
): string | null {
  if (!isKnownGitHost(gitUrl)) return null;
  return `https://${repoSlug(gitUrl)}/blob/${ref}/${filePath}`;
}

export function gitCompareUrl(
  gitUrl: string,
  from: string,
  to: string,
): string | null {
  if (!isKnownGitHost(gitUrl)) return null;
  return `https://${repoSlug(gitUrl)}/compare/${from}...${to}`;
}
