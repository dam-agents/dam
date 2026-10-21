const GITHUB_REPO =
  /^(?:https:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/;

/**
 * UNIT_BOUNDARY_DESCRIPTION: The `<owner>/<repo>` a pasted link to a kit's
 * repository names, or null when it names none. Only a repository's own
 * address is taken: a link into a branch or folder (`/tree/<ref>/<dir>`)
 * names a version the kit would not be read at, so it is refused rather than
 * quietly read at the default branch.
 */
export function kitLinkSlug(pasted: string): string | null {
  const match = GITHUB_REPO.exec(pasted.trim());
  if (!match) return null;
  const [, owner, repo] = match;
  if (repo === "." || repo === "..") return null;
  return `${owner}/${repo}`;
}

export function kitLinkUrl(slug: string): string {
  return `https://github.com/${slug}`;
}
