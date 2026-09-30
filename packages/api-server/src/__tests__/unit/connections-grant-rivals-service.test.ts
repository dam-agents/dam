/**
 * TEST_OVERVIEW: An agent is never granted two Connections the gateway cannot
 * tell apart: every request to their shared host would be refused. Two accounts
 * that hand the agent a token placeholder, such as two GitHub accounts, are told
 * apart by that value and stay grantable together; two header credentials on
 * one host with no placeholder are not, so the Connections service refuses that
 * grant, both when a grant is added to a running agent and when an agent is
 * created with its first grants. An agent that already holds such a pair can
 * still change its other grants, so the refusal never locks a user out of
 * fixing it. Among several GitHub accounts, the user marks the one the agent
 * acts as by default.
 */
import { describe, expect, it, vi } from "vitest";
import type { Connection, Contribution } from "api-server-api";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { createConnectionsService } from "../../modules/connections/services/connections-service.js";

type ConnectionsDeps = Parameters<typeof createConnectionsService>[0];

const OWNER = "owner-1";
const AGENT = "agent-1";

function unused<T extends object>(fields: Partial<T> = {}): T {
  return new Proxy(fields, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected dependency: ${String(key)}`);
    },
  }) as T;
}

function connection(
  id: string,
  templateId: string,
  contributions?: Contribution[],
): Connection {
  const template = buildCatalog().find((t) => t.id === templateId);
  if (!template) throw new Error(`${templateId} missing from catalog`);
  return {
    id,
    ownerId: OWNER,
    templateId,
    name: id,
    inputs: {},
    auth: { kind: "none" },
    contributions: contributions ?? [...template.contributions],
  };
}

function billingKey(id: string): Connection {
  return connection(id, "custom-header", [
    {
      kind: "egress-inject",
      host: "billing.acme.internal",
      headerName: "X-API-Key",
      valueFormat: "{value}",
    },
  ]);
}

const githubOAuth = connection("github", "github");
const githubToken = connection("github-token", "github-pat");
const billingA = billingKey("billing-a");
const billingB = billingKey("billing-b");
const slackA = connection("slack-a", "slack");
const slackB = connection("slack-b", "slack");

function setup(initialGrants: string[] = []) {
  const rows = [githubOAuth, githubToken, billingA, billingB, slackA, slackB];
  const byId = new Map(rows.map((c) => [c.id, c]));
  const grants = new Set(initialGrants);
  const grant = vi.fn(async (connectionId: string) => {
    grants.add(connectionId);
  });
  const setPreferred = vi.fn(async () => {});
  const fanOut = vi.fn(async () => {});
  const service = createConnectionsService({
    ownerId: OWNER,
    repo: unused<ConnectionsDeps["repo"]>({
      listByOwner: async () => rows,
      get: async (id) => byId.get(id) ?? null,
      listAgentGrants: async () =>
        [...grants].map((connectionId) => ({
          connectionId,
          grantedAt: new Date(0),
          preferred: false,
        })),
      listConnectionsForAgent: async () =>
        [...grants].map((id) => byId.get(id)!),
      grant,
      revoke: async (connectionId: string) => {
        grants.delete(connectionId);
      },
      setPreferred,
    }),
    templates: unused(),
    secretStore: unused(),
    fanOut: { apply: fanOut },
    oauthFlow: unused(),
    oauthEngine: unused(),
    githubAppEngine: unused(),
    oauthCallbackUrl: "https://example.com/callback",
    brandName: "Test",
    connectionLock: (_key, fn) => fn(),
    resolveKbShare: async () => null,
  });
  return { service, grants, grant, setPreferred, fanOut };
}

describe("granting Connections the gateway cannot tell apart", () => {
  /** TEST_SCENARIO: Two header credentials on one host hand the agent nothing
   * that could name either, so the grant is refused with a message naming both,
   * and nothing is written. */
  it("refuses a second header credential on the same host", async () => {
    const { service, grants, grant } = setup([billingA.id]);
    await expect(
      service.setAgentConnections(AGENT, [billingA.id, billingB.id]),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("'billing-a' and 'billing-b'"),
    });
    expect(grant).not.toHaveBeenCalled();
    expect([...grants]).toEqual([billingA.id]);
  });

  /** TEST_SCENARIO: The originally reported case. Both GitHub accounts hand the
   * agent a GH_TOKEN placeholder the gateway reads as the account, so the pair
   * is grantable. */
  it("grants two GitHub accounts together", async () => {
    const { service, grants } = setup([githubOAuth.id]);
    await service.setAgentConnections(AGENT, [githubOAuth.id, githubToken.id]);
    expect([...grants].sort()).toEqual([githubOAuth.id, githubToken.id]);
  });

  /** TEST_SCENARIO: Two Slack workspaces are addressed apart, so granting both
   * stays allowed. */
  it("grants two Slack workspaces together", async () => {
    const { service, grants } = setup();
    await service.setAgentConnections(AGENT, [slackA.id, slackB.id]);
    expect([...grants].sort()).toEqual([slackA.id, slackB.id]);
  });

  /** TEST_SCENARIO: An agent granted both credentials before this check existed
   * must still accept other changes, and removing one of the pair must work. */
  it("lets an agent that already holds both change its other grants", async () => {
    const { service, grants } = setup([billingA.id, billingB.id]);
    await service.setAgentConnections(AGENT, [
      billingA.id,
      billingB.id,
      slackA.id,
    ]);
    expect(grants.has(slackA.id)).toBe(true);
    await service.setAgentConnections(AGENT, [billingA.id, slackA.id]);
    expect(grants.has(billingB.id)).toBe(false);
  });

  /** TEST_SCENARIO: Agent creation checks its first grants before the agent is
   * stored, so a refused pair never leaves an agent behind without its grants. */
  it("refuses an agent created with two header credentials on one host", async () => {
    const { service } = setup();
    await expect(
      service.validateGrantSet([billingA.id, billingB.id]),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      service.validateGrantSet([githubOAuth.id, githubToken.id, slackA.id]),
    ).resolves.toBeUndefined();
  });
});

describe("choosing the account an agent acts as", () => {
  /** TEST_SCENARIO: Marking one GitHub account preferred clears the other on
   * the same host and re-delivers the agent's state, so gh's active account
   * follows the choice. */
  it("prefers one GitHub account and clears its sibling", async () => {
    const { service, setPreferred, fanOut } = setup([
      githubOAuth.id,
      githubToken.id,
      slackA.id,
    ]);
    await service.setPreferredConnection(AGENT, githubToken.id);
    expect(setPreferred).toHaveBeenCalledWith(AGENT, githubToken.id, [
      githubOAuth.id,
    ]);
    expect(fanOut).toHaveBeenCalledOnce();
  });

  /** TEST_SCENARIO: A Connection the agent does not hold cannot be its default. */
  it("refuses a connection the agent is not granted", async () => {
    const { service, setPreferred } = setup([githubOAuth.id]);
    await expect(
      service.setPreferredConnection(AGENT, githubToken.id),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(setPreferred).not.toHaveBeenCalled();
  });
});
