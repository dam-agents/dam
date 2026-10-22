import type { Contribution } from "agent-runtime-api";
import {
  defaultAccountGroups,
  type DefaultAccountGroup,
  type DefaultAccountKind,
  type DefaultAccountSource,
} from "./default-accounts.js";
import { connectionEgressPlaceholder } from "./egress-addressing.js";
import {
  GH_ENTERPRISE_TOKEN_ENV,
  GH_TOKEN_ENV,
  githubHostOf,
  isGitHubEnterpriseServer,
} from "./github-host.js";

export {
  GH_ENTERPRISE_TOKEN_ENV,
  GH_HOST_ENV,
  GH_TOKEN_ENV,
  githubHostOf,
  isGitHubEnterpriseServer,
} from "./github-host.js";
export const GH_HOSTS_FILE_PATH = "$HOME/.config/gh/hosts.yml";
export const GITCONFIG_FILE_PATH = "$HOME/.gitconfig";
export const GH_TOKEN_AVAILABLE_ENV = "PLATFORM_GH_TOKEN_AVAILABLE";

export type GitHubAccountSource = DefaultAccountSource;
export type GitHubAccountGroup = DefaultAccountGroup<"github">;

function accountSlug(text: string): string {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((part) => part !== "")
    .join("-");
}

export const githubAccountKind: DefaultAccountKind<"github"> = {
  id: "github",
  scopeOf: githubHostOf,
  naming: { slug: accountSlug, fallback: "account" },
  minAccounts: 2,
};

export function githubAccountGroups(
  granted: readonly GitHubAccountSource[],
): GitHubAccountGroup[] {
  return defaultAccountGroups(githubAccountKind, granted);
}

function ghHostsFile(group: GitHubAccountGroup): Contribution {
  const active = group.accounts.find((a) => a.active) ?? group.accounts[0]!;
  const users = Object.fromEntries(
    group.accounts.map((a) => [
      a.name,
      { oauth_token: connectionEgressPlaceholder(a.connectionId) },
    ]),
  );
  return {
    kind: "file",
    path: GH_HOSTS_FILE_PATH,
    format: "yaml",
    mergeMode: "key-targeted",
    content: {
      [group.scope]: {
        git_protocol: "https",
        user: active.name,
        oauth_token: connectionEgressPlaceholder(active.connectionId),
        users,
      },
    },
  };
}

function isReplacedByHostsFile(c: Contribution): boolean {
  return (
    (c.kind === "env" && c.name === GH_TOKEN_ENV) ||
    (c.kind === "file" && c.path === GH_HOSTS_FILE_PATH)
  );
}

function isCommitIdentity(c: Contribution): boolean {
  return c.kind === "file" && c.path === GITCONFIG_FILE_PATH;
}

function withEnterpriseTokenEnv(source: GitHubAccountSource): Contribution[] {
  const host = githubHostOf(source.contributions);
  if (host === undefined || !isGitHubEnterpriseServer(host)) {
    return source.contributions;
  }
  return source.contributions.map((c) =>
    c.kind === "env" && c.name === GH_TOKEN_ENV
      ? { ...c, name: GH_ENTERPRISE_TOKEN_ENV }
      : c,
  );
}

export function composeGitHubAccounts(
  granted: readonly GitHubAccountSource[],
): Contribution[] {
  const groups = githubAccountGroups(granted);
  if (groups.length === 0) {
    return granted.flatMap(withEnterpriseTokenEnv);
  }
  const grouped = new Set(
    groups.flatMap((group) => group.accounts.map((a) => a.connectionId)),
  );
  const active = new Set(
    groups.flatMap((group) =>
      group.accounts.filter((a) => a.active).map((a) => a.connectionId),
    ),
  );
  const out: Contribution[] = [];
  for (const source of granted) {
    if (!grouped.has(source.id)) {
      out.push(...withEnterpriseTokenEnv(source));
      continue;
    }
    const keepsIdentity = active.has(source.id);
    out.push(
      ...source.contributions.filter(
        (c) =>
          !isReplacedByHostsFile(c) && (keepsIdentity || !isCommitIdentity(c)),
      ),
    );
  }
  for (const group of groups) out.push(ghHostsFile(group));
  out.push({ kind: "env", name: GH_TOKEN_AVAILABLE_ENV, placeholder: "true" });
  return out;
}
