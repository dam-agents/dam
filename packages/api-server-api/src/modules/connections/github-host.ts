import type { Contribution } from "agent-runtime-api";

export const GH_TOKEN_ENV = "GH_TOKEN";
export const GH_HOST_ENV = "GH_HOST";
const GITHUB_HOST = "github.com";

export function githubHostOf(
  contributions: readonly Contribution[],
): string | undefined {
  let hasToken = false;
  let host: string | undefined;
  for (const c of contributions) {
    if (c.kind !== "env") continue;
    if (c.name === GH_TOKEN_ENV) hasToken = true;
    else if (c.name === GH_HOST_ENV) host = c.placeholder;
  }
  return hasToken ? (host ?? GITHUB_HOST).toLowerCase() : undefined;
}
