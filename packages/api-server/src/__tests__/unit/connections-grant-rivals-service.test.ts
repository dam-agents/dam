/**
 * TEST_OVERVIEW: An agent is never granted two Connections the gateway cannot
 * tell apart, such as two GitHub accounts: every request to their shared host
 * would be refused. The Connections service refuses such a grant, both when a
 * grant is added to a running agent and when an agent is created with its first
 * grants. An agent that already holds such a pair can still change its other
 * grants, so the refusal never locks a user out of fixing it.
 */
import { describe, expect, it, vi } from "vitest";
import type { Connection } from "api-server-api";
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

function connection(id: string, templateId: string): Connection {
  const template = buildCatalog().find((t) => t.id === templateId);
  if (!template) throw new Error(`${templateId} missing from catalog`);
  return {
    id,
    ownerId: OWNER,
    templateId,
    name: id,
    inputs: {},
    auth: { kind: "none" },
    contributions: [...template.contributions],
  };
}

const githubOAuth = connection("github", "github");
const githubToken = connection("github-token", "github-pat");
const slackA = connection("slack-a", "slack");
const slackB = connection("slack-b", "slack");

function setup(initialGrants: string[] = []) {
  const rows = [githubOAuth, githubToken, slackA, slackB];
  const grants = new Set(initialGrants);
  const grant = vi.fn(async (connectionId: string) => {
    grants.add(connectionId);
  });
  const service = createConnectionsService({
    ownerId: OWNER,
    repo: unused<ConnectionsDeps["repo"]>({
      listByOwner: async () => rows,
      listAgentGrants: async () =>
        [...grants].map((connectionId) => ({
          connectionId,
          grantedAt: new Date(0),
        })),
      grant,
      revoke: async (connectionId: string) => {
        grants.delete(connectionId);
      },
    }),
    templates: unused(),
    secretStore: unused(),
    fanOut: { apply: async () => {} },
    oauthFlow: unused(),
    oauthEngine: unused(),
    githubAppEngine: unused(),
    oauthCallbackUrl: "https://example.com/callback",
    brandName: "Test",
    connectionLock: (_key, fn) => fn(),
    resolveKbShare: async () => null,
  });
  return { service, grants, grant };
}

describe("granting Connections the gateway cannot tell apart", () => {
  /** TEST_SCENARIO: The reported case. The agent uses GitHub OAuth, and the user
   * adds a GitHub token. The grant is refused with a message naming both, and
   * nothing is written. */
  it("refuses a second GitHub account on an agent", async () => {
    const { service, grants, grant } = setup([githubOAuth.id]);
    await expect(
      service.setAgentConnections(AGENT, [githubOAuth.id, githubToken.id]),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("'github' and 'github-token'"),
    });
    expect(grant).not.toHaveBeenCalled();
    expect([...grants]).toEqual([githubOAuth.id]);
  });

  /** TEST_SCENARIO: Two Slack workspaces are addressed apart, so granting both
   * stays allowed. */
  it("grants two Slack workspaces together", async () => {
    const { service, grants } = setup();
    await service.setAgentConnections(AGENT, [slackA.id, slackB.id]);
    expect([...grants].sort()).toEqual([slackA.id, slackB.id]);
  });

  /** TEST_SCENARIO: An agent granted both GitHub accounts before this check
   * existed must still accept other changes, and removing one of the pair must
   * work. */
  it("lets an agent that already holds both change its other grants", async () => {
    const { service, grants } = setup([githubOAuth.id, githubToken.id]);
    await service.setAgentConnections(AGENT, [
      githubOAuth.id,
      githubToken.id,
      slackA.id,
    ]);
    expect(grants.has(slackA.id)).toBe(true);
    await service.setAgentConnections(AGENT, [githubOAuth.id, slackA.id]);
    expect(grants.has(githubToken.id)).toBe(false);
  });

  /** TEST_SCENARIO: Agent creation checks its first grants before the agent is
   * stored, so a refused pair never leaves an agent behind without its grants. */
  it("refuses an agent created with two GitHub accounts", async () => {
    const { service } = setup();
    await expect(
      service.validateGrantSet([githubOAuth.id, githubToken.id]),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      service.validateGrantSet([githubOAuth.id, slackA.id, slackB.id]),
    ).resolves.toBeUndefined();
  });
});
