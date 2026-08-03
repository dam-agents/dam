/**
 * Default a skill-source name from its git URL: the URL path, minus a leading
 * `/`, a trailing `/`, and a trailing `.git`.
 *   https://github.com/apocohq/skills(.git)(/) → "apocohq/skills"
 *   https://gitlab.com/group/subgroup/repo      → "group/subgroup/repo"
 *   https://github.com                          → ""  (underivable)
 * Returns "" on parse failure or an empty path. Slashes are kept on purpose —
 * skill-source names allow them (schema is min(1).max(128) with no slug
 * pattern), unlike connection names, so this does NOT slugify.
 */
export function deriveSourceName(gitUrl: string): string {
  let pathname: string;
  try {
    pathname = new URL(gitUrl).pathname;
  } catch {
    return "";
  }
  return pathname
    .replace(/^\//, "")
    .replace(/\/$/, "")
    .replace(/\.git$/, "");
}
