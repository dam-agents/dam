const GITHUB_HOSTS = new Set([
  "github.com",
  "api.github.com",
  "codeload.github.com",
  "raw.githubusercontent.com",
]);

// UNIT_BOUNDARY_DESCRIPTION: GitHub resolves owner and repository in any letter case, so a deny for `/repos/o/r/*` must also stop `/repos/O/R/…`; an allow keeps exact case, because file paths are case-sensitive and a case-blind allow for `qa/` would open `QA/` too.
export function denyIgnoresPathCase(host: string): boolean {
  return GITHUB_HOSTS.has(host) || host.endsWith(".ghe.com");
}
