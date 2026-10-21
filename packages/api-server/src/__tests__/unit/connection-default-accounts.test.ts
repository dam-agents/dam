/**
 * TEST_OVERVIEW: When an Agent holds several Connections of one kind that
 * compete for "default" — GitHub accounts on one host, or storage Connections
 * as AWS profiles — one shared rule decides their order, the default and their
 * names. Grants sort by grant time, ties broken on the connection id; the
 * preferred grant is the default, else the earliest; names come from the
 * Connection names, kept distinct and clear of names the tool reserves. Only
 * the kind decides how its Connections are grouped and how a name is slugged,
 * so GitHub and storage agree on the rules but keep the names the Agent already
 * holds. A kind of its own needs no edit to either.
 */
import { describe, expect, it } from "vitest";
import type { Contribution, DefaultAccountKind } from "api-server-api";
import {
  applyConnectionEgressAddressing,
  awsProfiles,
  contestedDefaultAccounts,
  defaultAccountGroups,
  githubAccountGroups,
  preferenceGroupOf,
  type DefaultAccountSource,
} from "api-server-api";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { buildS3Contributions } from "../../modules/connections/domain/s3-contributions.js";

function source(
  id: string,
  name: string,
  contributions: Contribution[],
  opts: { preferred?: boolean; grantedAt?: string } = {},
): DefaultAccountSource {
  return {
    id,
    name,
    preferred: opts.preferred ?? false,
    ...(opts.grantedAt ? { grantedAt: opts.grantedAt } : {}),
    contributions: applyConnectionEgressAddressing(id, contributions),
  };
}

function github(
  id: string,
  name: string,
  opts: { preferred?: boolean; grantedAt?: string } = {},
): DefaultAccountSource {
  const template = buildCatalog().find((t) => t.id === "github-pat");
  if (!template) throw new Error("github-pat missing from catalog");
  return source(id, name, [...template.contributions], opts);
}

function storage(
  id: string,
  name: string,
  opts: { preferred?: boolean; grantedAt?: string; host?: string } = {},
): DefaultAccountSource {
  return source(
    id,
    name,
    buildS3Contributions({
      host: opts.host ?? "s3.example.com",
      region: "us-east-1",
      service: "s3",
    }),
    opts,
  );
}

describe("defaultAccountGroups", () => {
  /** TEST_SCENARIO: A kind the platform does not ship groups its Connections
   * with the shared rule alone: grant order, preferred grant and naming come
   * out the same as for GitHub, with nothing GitHub- or S3-specific in it. */
  it("orders, picks and names the accounts of any kind", () => {
    const kind: DefaultAccountKind<"demo"> = {
      id: "demo",
      scopeOf: () => "one",
      naming: {
        slug: (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        fallback: "demo",
        reserved: new Set(["main"]),
      },
      minAccounts: 1,
    };
    const [group] = defaultAccountGroups(kind, [
      github("c", "Main", { grantedAt: "2026-09-03T00:00:00Z" }),
      github("b", "Work", {
        grantedAt: "2026-09-02T00:00:00Z",
        preferred: true,
      }),
      github("a", "Work", { grantedAt: "2026-09-01T00:00:00Z" }),
    ]);
    expect(group?.key).toBe("demo:one");
    expect(
      group?.accounts.map((a) => [a.connectionId, a.name, a.active]),
    ).toEqual([
      ["a", "work", false],
      ["b", "work-b", true],
      ["c", "main-c", false],
    ]);
  });

  /** TEST_SCENARIO: An Agent without any choice keeps the account it used
   * first, and grants with no grant time sort after the timed ones. */
  it("makes the earliest timed grant the default without a preference", () => {
    const [group] = githubAccountGroups([
      github("conn-c", "Later"),
      github("conn-b", "Second", { grantedAt: "2026-09-02T00:00:00Z" }),
      github("conn-a", "First", { grantedAt: "2026-09-01T00:00:00Z" }),
    ]);
    expect(group?.accounts.map((a) => [a.connectionId, a.active])).toEqual([
      ["conn-a", true],
      ["conn-b", false],
      ["conn-c", false],
    ]);
  });
});

describe("AWS profiles on the shared rule", () => {
  /** TEST_SCENARIO: Profile names are what the Agent passes to --profile, so
   * they stay what they were: `default` is AWS's own profile, a clash adds the
   * first eight characters of the connection id, and an empty name falls back
   * to `storage`. */
  it("keeps the profile names the agent already holds", () => {
    const profiles = awsProfiles([
      storage("conn-1234567890", "Default", {
        grantedAt: "2026-09-01T00:00:00Z",
      }),
      storage("conn-b", "Data_Lake", { grantedAt: "2026-09-02T00:00:00Z" }),
      storage("conn-c", "data_lake", { grantedAt: "2026-09-03T00:00:00Z" }),
      storage("conn-d", "!!!", { grantedAt: "2026-09-04T00:00:00Z" }),
    ]);
    expect(profiles.map((p) => p.profile)).toEqual([
      "default-conn-123",
      "data_lake",
      "data_lake-conn-c",
      "storage",
    ]);
  });

  /** TEST_SCENARIO: A single storage Connection is still a profile, and the
   * Agent's storage Connections are one group whatever their endpoints. */
  it("makes one profile group of every storage connection", () => {
    expect(awsProfiles([storage("conn-a", "Only")])).toEqual([
      expect.objectContaining({ profile: "only", active: true }),
    ]);
    const profiles = awsProfiles([
      storage("conn-a", "East", { grantedAt: "2026-09-01T00:00:00Z" }),
      storage("conn-b", "West", {
        grantedAt: "2026-09-02T00:00:00Z",
        host: "s3.west.example.com",
        preferred: true,
      }),
    ]);
    expect(profiles.map((p) => [p.profile, p.active, p.endpointUrl])).toEqual([
      ["east", false, "https://s3.example.com"],
      ["west", true, "https://s3.west.example.com"],
    ]);
  });
});

describe("contestedDefaultAccounts", () => {
  /** TEST_SCENARIO: The connections panel asks one question for every kind:
   * which groups have more than one account to choose from. A lone GitHub
   * account or a lone storage Connection has no choice to offer. */
  it("lists only the groups that offer a choice, of every kind", () => {
    const groups = contestedDefaultAccounts([
      github("gh-a", "Work", { grantedAt: "2026-09-01T00:00:00Z" }),
      github("gh-b", "Personal", { grantedAt: "2026-09-02T00:00:00Z" }),
      storage("s3-a", "Lake"),
    ]);
    expect(groups.map((g) => [g.kind, g.scope, g.accounts.length])).toEqual([
      ["github", "github.com", 2],
    ]);
    const both = contestedDefaultAccounts([
      github("gh-a", "Work"),
      github("gh-b", "Personal"),
      storage("s3-a", "Lake"),
      storage("s3-b", "Archive"),
    ]);
    expect(both.map((g) => g.key)).toEqual([
      "github:github.com",
      "aws-profile",
    ]);
  });

  /** TEST_SCENARIO: Marking a default clears the other grants of its group,
   * so the group a Connection belongs to must be the key the panel shows. */
  it("keys each group as preferenceGroupOf names its connections", () => {
    const gh = github("gh-a", "Work");
    const s3 = storage("s3-a", "Lake");
    const groups = contestedDefaultAccounts([
      gh,
      github("gh-b", "Personal"),
      s3,
      storage("s3-b", "Archive"),
    ]);
    expect(groups.map((g) => g.key)).toEqual([
      preferenceGroupOf(gh.contributions),
      preferenceGroupOf(s3.contributions),
    ]);
  });
});
