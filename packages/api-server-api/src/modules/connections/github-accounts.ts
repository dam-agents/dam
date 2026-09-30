import type { Contribution } from "agent-runtime-api";
import { connectionEgressPlaceholder } from "./egress-addressing.js";
import { GH_TOKEN_ENV, githubHostOf } from "./github-host.js";

export { GH_HOST_ENV, GH_TOKEN_ENV, githubHostOf } from "./github-host.js";
export const GH_HOSTS_FILE_PATH = "$HOME/.config/gh/hosts.yml";
export const GH_TOKEN_AVAILABLE_ENV = "PLATFORM_GH_TOKEN_AVAILABLE";

export interface GitHubAccountSource {
  id: string;
  name: string;
  preferred: boolean;
  grantedAt?: string;
  contributions: Contribution[];
}

export interface GitHubAccount {
  connectionId: string;
  connectionName: string;
  account: string;
  active: boolean;
}

export interface GitHubAccountGroup {
  host: string;
  accounts: GitHubAccount[];
}

function accountSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function accountNames(members: readonly GitHubAccountSource[]): string[] {
  const taken = new Set<string>();
  return members.map((member) => {
    const base = accountSlug(member.name) || "account";
    const name = taken.has(base) ? `${base}-${accountSlug(member.id)}` : base;
    taken.add(name);
    return name;
  });
}

function byGrantTime(a: GitHubAccountSource, b: GitHubAccountSource): number {
  if (a.grantedAt === b.grantedAt) return 0;
  if (a.grantedAt === undefined) return 1;
  if (b.grantedAt === undefined) return -1;
  return a.grantedAt < b.grantedAt ? -1 : 1;
}

export function githubAccountGroups(
  granted: readonly GitHubAccountSource[],
): GitHubAccountGroup[] {
  const byHost = new Map<string, GitHubAccountSource[]>();
  for (const source of granted) {
    const host = githubHostOf(source.contributions);
    if (!host) continue;
    byHost.set(host, [...(byHost.get(host) ?? []), source]);
  }
  const groups: GitHubAccountGroup[] = [];
  for (const [host, unordered] of byHost) {
    if (unordered.length < 2) continue;
    const members = [...unordered].sort(byGrantTime);
    const activeIndex = Math.max(
      0,
      members.findIndex((member) => member.preferred),
    );
    const names = accountNames(members);
    groups.push({
      host,
      accounts: members.map((member, index) => ({
        connectionId: member.id,
        connectionName: member.name,
        account: names[index] ?? member.id,
        active: index === activeIndex,
      })),
    });
  }
  return groups;
}

function ghHostsFile(group: GitHubAccountGroup): Contribution {
  const active = group.accounts.find((a) => a.active) ?? group.accounts[0]!;
  const users = Object.fromEntries(
    group.accounts.map((a) => [
      a.account,
      { oauth_token: connectionEgressPlaceholder(a.connectionId) },
    ]),
  );
  return {
    kind: "file",
    path: GH_HOSTS_FILE_PATH,
    format: "yaml",
    mergeMode: "key-targeted",
    content: {
      [group.host]: {
        git_protocol: "https",
        user: active.account,
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

export function composeGitHubAccounts(
  granted: readonly GitHubAccountSource[],
): Contribution[] {
  const groups = githubAccountGroups(granted);
  if (groups.length === 0) {
    return granted.flatMap((source) => source.contributions);
  }
  const grouped = new Set(
    groups.flatMap((group) => group.accounts.map((a) => a.connectionId)),
  );
  const out: Contribution[] = [];
  for (const source of granted) {
    out.push(
      ...(grouped.has(source.id)
        ? source.contributions.filter((c) => !isReplacedByHostsFile(c))
        : source.contributions),
    );
  }
  for (const group of groups) out.push(ghHostsFile(group));
  out.push({ kind: "env", name: GH_TOKEN_AVAILABLE_ENV, placeholder: "true" });
  return out;
}
