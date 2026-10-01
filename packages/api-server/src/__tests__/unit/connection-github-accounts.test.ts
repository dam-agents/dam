/**
 * TEST_OVERVIEW: Two GitHub Connections on one host cannot both hand the agent a
 * GH_TOKEN, because gh reads one env value and lets it override its config
 * file. When an agent holds two, the platform stops contributing the env and
 * writes both accounts into gh's own multi-account hosts file, each under its
 * per-Connection token placeholder, with the preferred grant active. The agent
 * switches with `gh auth switch`; a single GitHub Connection is untouched.
 * The commit identity git uses follows the active account: only its name and
 * email are delivered, and an active account without one delivers none.
 */
import { describe, expect, it } from "vitest";
import type { Contribution } from "api-server-api";
import {
  GH_HOSTS_FILE_PATH,
  GITCONFIG_FILE_PATH,
  applyConnectionEgressAddressing,
  composeGitHubAccounts,
  githubAccountGroups,
  type GitHubAccountSource,
} from "api-server-api";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";

function templateContributions(templateId: string): Contribution[] {
  const template = buildCatalog().find((t) => t.id === templateId);
  if (!template) throw new Error(`${templateId} missing from catalog`);
  return [...template.contributions];
}

function github(
  id: string,
  name: string,
  opts: { preferred?: boolean; grantedAt?: string } = {},
): GitHubAccountSource {
  return {
    id,
    name,
    preferred: opts.preferred ?? false,
    ...(opts.grantedAt ? { grantedAt: opts.grantedAt } : {}),
    contributions: applyConnectionEgressAddressing(
      id,
      templateContributions("github-pat"),
    ),
  };
}

function withIdentity(
  source: GitHubAccountSource,
  name: string,
  email: string,
): GitHubAccountSource {
  return {
    ...source,
    contributions: [
      ...source.contributions,
      {
        kind: "file",
        path: GITCONFIG_FILE_PATH,
        format: "ini",
        mergeMode: "section-marker",
        content: { user: { name, email } },
      },
    ],
  };
}

function commitIdentities(contributions: Contribution[]): unknown[] {
  return contributions.flatMap((c) =>
    c.kind === "file" && c.path === GITCONFIG_FILE_PATH ? [c.content] : [],
  );
}

function hostsFile(contributions: Contribution[]): Record<string, unknown> {
  const file = contributions.find(
    (c) => c.kind === "file" && c.path === GH_HOSTS_FILE_PATH,
  );
  if (file?.kind !== "file") throw new Error("no gh hosts file");
  return file.content as Record<string, unknown>;
}

function envNames(contributions: Contribution[]): string[] {
  return contributions.flatMap((c) => (c.kind === "env" ? [c.name] : []));
}

describe("githubAccountGroups", () => {
  /** TEST_SCENARIO: One GitHub Connection is no group: gh keeps working from
   * GH_TOKEN exactly as before. */
  it("forms no group for a single GitHub connection", () => {
    expect(githubAccountGroups([github("conn-a", "Work")])).toEqual([]);
  });

  /** TEST_SCENARIO: The account the agent already used, the earliest grant, stays
   * the one it acts as when a second is added. */
  it("makes the earliest grant the active account by default", () => {
    const [group] = githubAccountGroups([
      github("conn-b", "Personal", { grantedAt: "2026-09-02T00:00:00Z" }),
      github("conn-a", "Work", { grantedAt: "2026-09-01T00:00:00Z" }),
    ]);
    expect(group?.host).toBe("github.com");
    expect(group?.accounts.map((a) => [a.account, a.active])).toEqual([
      ["work", true],
      ["personal", false],
    ]);
  });

  /** TEST_SCENARIO: A user-chosen preferred grant beats grant order. */
  it("lets the preferred grant override grant order", () => {
    const [group] = githubAccountGroups([
      github("conn-a", "Work", { grantedAt: "2026-09-01T00:00:00Z" }),
      github("conn-b", "Personal", {
        grantedAt: "2026-09-02T00:00:00Z",
        preferred: true,
      }),
    ]);
    expect(group?.accounts.find((a) => a.active)?.connectionId).toBe("conn-b");
  });

  /** TEST_SCENARIO: Two grants made in one call share a grant time. The active
   * account must still be the same one on every delivery, so the tie breaks on
   * the connection id rather than on input order. */
  it("breaks equal grant times on the connection id", () => {
    const at = "2026-09-01T00:00:00Z";
    const [forward] = githubAccountGroups([
      github("conn-b", "Personal", { grantedAt: at }),
      github("conn-a", "Work", { grantedAt: at }),
    ]);
    const [reversed] = githubAccountGroups([
      github("conn-a", "Work", { grantedAt: at }),
      github("conn-b", "Personal", { grantedAt: at }),
    ]);
    expect(forward?.accounts.find((a) => a.active)?.connectionId).toBe(
      "conn-a",
    );
    expect(reversed?.accounts.map((a) => a.connectionId)).toEqual(
      forward?.accounts.map((a) => a.connectionId),
    );
  });

  /** TEST_SCENARIO: Account names are what `gh auth switch -u` takes, so they
   * are derived from the Connection names and kept distinct. */
  it("derives distinct account names from the connection names", () => {
    const [group] = githubAccountGroups([
      github("conn-a", "GitHub (PAT)"),
      github("conn-b", "GitHub (PAT)"),
    ]);
    expect(group?.accounts.map((a) => a.account)).toEqual([
      "github-pat",
      "github-pat-conn-b",
    ]);
  });
});

describe("composeGitHubAccounts", () => {
  /** TEST_SCENARIO: The single-account case is delivered untouched. */
  it("passes a single GitHub connection through unchanged", () => {
    const only = github("conn-a", "Work");
    expect(composeGitHubAccounts([only])).toEqual(only.contributions);
  });

  /** TEST_SCENARIO: gh reads GH_TOKEN ahead of its hosts file, so the env must
   * go for the switch to take effect, and both accounts land in the file under
   * their own placeholders with the active one mirrored where gh reads it. */
  it("replaces both GH_TOKEN envs with one multi-account hosts file", () => {
    const out = composeGitHubAccounts([
      github("conn-a", "Work", { grantedAt: "2026-09-01T00:00:00Z" }),
      github("conn-b", "Personal", { grantedAt: "2026-09-02T00:00:00Z" }),
    ]);
    expect(envNames(out)).not.toContain("GH_TOKEN");
    expect(hostsFile(out)).toEqual({
      "github.com": {
        git_protocol: "https",
        user: "work",
        oauth_token: "platform:conn:conn-a",
        users: {
          work: { oauth_token: "platform:conn:conn-a" },
          personal: { oauth_token: "platform:conn:conn-b" },
        },
      },
    });
  });

  /** TEST_SCENARIO: The runtime derives the gh availability flag from GH_TOKEN,
   * which is now absent, so the platform states it explicitly. */
  it("states that gh credentials are available", () => {
    const out = composeGitHubAccounts([
      github("conn-a", "Work"),
      github("conn-b", "Personal"),
    ]);
    expect(out).toContainEqual({
      kind: "env",
      name: "PLATFORM_GH_TOKEN_AVAILABLE",
      placeholder: "true",
    });
  });

  /** TEST_SCENARIO: The gateway injections are what make the accounts work, so
   * they must survive the composition for both Connections. */
  it("keeps every other contribution of both connections", () => {
    const out = composeGitHubAccounts([
      github("conn-a", "Work"),
      github("conn-b", "Personal"),
    ]);
    const injectedHosts = out.flatMap((c) =>
      c.kind === "egress-inject" ? [c.host] : [],
    );
    expect(injectedHosts.filter((h) => h === "api.github.com")).toHaveLength(2);
  });

  /** TEST_SCENARIO: Each OAuth account writes its own [user] block, and git
   * takes the last one, so the agent would commit as whichever Connection was
   * created last. Only the active account's identity may reach the file. */
  it("delivers only the active account's commit identity", () => {
    const out = composeGitHubAccounts([
      withIdentity(
        github("conn-a", "Work", { grantedAt: "2026-09-01T00:00:00Z" }),
        "Work Bot",
        "work@example.com",
      ),
      withIdentity(
        github("conn-b", "Personal", { grantedAt: "2026-09-02T00:00:00Z" }),
        "Pat",
        "pat@example.com",
      ),
    ]);
    expect(commitIdentities(out)).toEqual([
      { user: { name: "Work Bot", email: "work@example.com" } },
    ]);
  });

  /** TEST_SCENARIO: The preferred grant is the active account, so its identity
   * is the one delivered even when it was granted later. */
  it("follows the preferred grant's commit identity", () => {
    const out = composeGitHubAccounts([
      withIdentity(
        github("conn-a", "Work", { grantedAt: "2026-09-01T00:00:00Z" }),
        "Work Bot",
        "work@example.com",
      ),
      withIdentity(
        github("conn-b", "Personal", {
          grantedAt: "2026-09-02T00:00:00Z",
          preferred: true,
        }),
        "Pat",
        "pat@example.com",
      ),
    ]);
    expect(commitIdentities(out)).toEqual([
      { user: { name: "Pat", email: "pat@example.com" } },
    ]);
  });

  /** TEST_SCENARIO: A token or App account has no identity of its own. When it
   * is the active one, the other account's name must not stand in for it, so
   * nothing is delivered and git asks for an identity instead. */
  it("delivers no commit identity when the active account has none", () => {
    const out = composeGitHubAccounts([
      github("conn-a", "Work", { grantedAt: "2026-09-01T00:00:00Z" }),
      withIdentity(
        github("conn-b", "Personal", { grantedAt: "2026-09-02T00:00:00Z" }),
        "Pat",
        "pat@example.com",
      ),
    ]);
    expect(commitIdentities(out)).toEqual([]);
  });

  /** TEST_SCENARIO: A GitHub Connection on a different host is a different
   * group, so it keeps its own env beside the github.com pair. */
  it("groups by gh host", () => {
    const enterprise: GitHubAccountSource = {
      id: "conn-ghe",
      name: "GHE",
      preferred: false,
      contributions: [
        { kind: "env", name: "GH_TOKEN", placeholder: "platform:conn:ghe" },
        { kind: "env", name: "GH_HOST", placeholder: "ghe.acme.com" },
      ],
    };
    const out = composeGitHubAccounts([
      github("conn-a", "Work"),
      enterprise,
      github("conn-b", "Personal"),
    ]);
    expect(envNames(out).filter((n) => n === "GH_TOKEN")).toHaveLength(1);
    expect(Object.keys(hostsFile(out))).toEqual(["github.com"]);
  });
});
