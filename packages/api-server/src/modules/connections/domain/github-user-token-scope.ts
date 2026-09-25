import type { GitHubUserTokenScope } from "api-server-api";
import { parsePermissions, parseRepositoryIds } from "./github-app-scope.js";

const GITHUB_USER_TOKEN_TEMPLATE_IDS = new Set(["github", "github-enterprise"]);

export function supportsGitHubUserTokenScope(templateId: string): boolean {
  return GITHUB_USER_TOKEN_TEMPLATE_IDS.has(templateId);
}

export function gitHubUserTokenApiBase(host: string | undefined): string {
  return host && host !== "github.com"
    ? `https://${host}/api/v3`
    : "https://api.github.com";
}

export function parseGitHubUserTokenScope(input: {
  targetId?: number | undefined;
  targetLogin?: string | undefined;
  repositoryIds?: string | undefined;
  permissions?: string | undefined;
}): GitHubUserTokenScope | undefined {
  const repositoryIds = parseRepositoryIds(input.repositoryIds);
  const permissions = parsePermissions(input.permissions);
  if (input.targetId === undefined) {
    if (repositoryIds || permissions) {
      throw new Error(
        "Choose the account to narrow to before choosing repositories or permissions.",
      );
    }
    return undefined;
  }
  return {
    targetId: input.targetId,
    ...(input.targetLogin ? { targetLogin: input.targetLogin } : {}),
    ...(repositoryIds?.length
      ? { repositoryIds: repositoryIds as [number, ...number[]] }
      : {}),
    ...(permissions ? { permissions } : {}),
  };
}

export function earliestExpiry(
  a: number | undefined,
  b: number | undefined,
): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}
