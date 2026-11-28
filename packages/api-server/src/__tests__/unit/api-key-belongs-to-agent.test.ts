// TEST_OVERVIEW: An API key can belong to an Agent. A call made with such a key is that Agent's call: the login names the Agent as the caller, and the security log names it. The key ends when the Agent is deleted. A key that belongs to nobody behaves as before. Only the platform issues such a key, bound to its Agent with the read scope alone; no person creates one.
import { describe, expect, it, vi } from "vitest";

vi.mock("jose", () => ({
  createRemoteJWKSet: () => Object.assign(() => ({}), { reload: vi.fn() }),
  jwtVerify: vi.fn(),
}));

import type { Scope } from "api-server-api";
import {
  createAuth,
  logWsAttach,
} from "../../apps/api-server/admission/auth.js";
import { createRelayAdmission } from "../../apps/api-server/agent-proxies/upgrade.js";
import { configureLogger } from "../../core/logger.js";
import type { ApiKeyRow } from "../../modules/api-keys/domain/types.js";
import { createAgentKeysCleanup } from "../../modules/api-keys/services/agent-keys-cleanup.js";
import { createAgentKeyIssuer } from "../../modules/api-keys/services/agent-key-issuer.js";
import type { NewApiKey } from "../../modules/api-keys/domain/types.js";
import { createApiKeyValidator } from "../../modules/api-keys/services/api-key-validator.js";

const OWNER = "owner-1";
const AGENT = "agent-a";
const READ: Scope[] = ["agents:read"];

function capture() {
  const lines: string[] = [];
  configureLogger({ level: "info", write: (l) => lines.push(l) });
  return { records: () => lines.map((l) => JSON.parse(l)) };
}

function login(row: ApiKeyRow) {
  return createAuth(
    { issuers: ["http://kc/realms/platform"], jwksUrl: "http://kc/jwks" },
    {
      verifyApiKey: createApiKeyValidator({
        hashToken: (token) => token,
        findByHash: async () => row,
        touchLastUsed: async () => {},
      }),
      verifyOwnerActive: async () => "active",
    },
  );
}

const keyRow = (over: Partial<ApiKeyRow> = {}): ApiKeyRow => ({
  id: "key-1",
  ownerSub: OWNER,
  name: "helper",
  hash: "pk_token",
  scopes: READ,
  agentIds: [AGENT],
  agentId: AGENT,
  expiresAt: null,
  createdAt: new Date(0),
  lastUsedAt: null,
  revokedAt: null,
  ...over,
});

describe("a call made with a key that belongs to an Agent", () => {
  // TEST_SCENARIO: the login turns the key into a caller that is the Agent. It keeps the key's id, scopes and binding, so everything that limits a key still applies, and it names the Agent as the one acting.
  it("makes the Agent the caller", async () => {
    const { user } = await login(keyRow()).verify("pk_token");
    expect(user).toEqual({
      sub: OWNER,
      preferredUsername: OWNER,
      scopes: READ,
      agentIds: [AGENT],
      keyId: "key-1",
      actingAgent: AGENT,
    });
  });

  // TEST_SCENARIO: a key that belongs to nobody is its owner's call, as before: the caller names no Agent.
  it("leaves the caller of any other key as the owner", async () => {
    const { user } = await login(
      keyRow({ agentId: null, agentIds: null }),
    ).verify("pk_token");
    expect(user).not.toHaveProperty("actingAgent");
    expect(user.agentIds).toBe("*");
  });

  // TEST_SCENARIO: an attach to a live socket is a security record. For the Agent's key it names the Agent as the actor, and for any other caller the person.
  it("names the Agent in the attach record, and the person otherwise", () => {
    const cap = capture();
    const site = { edge: "ws" as const, relay: "trpc" };
    logWsAttach({ sub: OWNER, actingAgent: AGENT }, site);
    logWsAttach({ sub: OWNER }, site);
    const attaches = cap.records().filter((r) => r.msg === "relay.attach");
    expect(attaches.map((r) => [r.actor, r.actorKind])).toEqual([
      [AGENT, "agent"],
      [OWNER, "user"],
    ]);
  });

  // TEST_SCENARIO: the Agent's key tries a live socket of an Agent its owner does not own. The refusal is the Agent's, so the record names the Agent, not the owner.
  it("names the Agent when a relay refuses it", async () => {
    const cap = capture();
    const admission = createRelayAdmission({
      authenticate: async () => ({
        ok: true,
        principal: {
          user: (await login(keyRow()).verify("pk_token")).user,
          azp: "",
          roles: [],
        },
      }),
      standingOf: async () => null,
      editorSockets: { track: () => {}, close: () => {} },
      isTermsAccepted: async () => true,
      surfaceAttribution: { uiClientId: "platform-ui", cliClientId: "cli" },
    });
    const admitted = await admission(
      { headers: {}, socket: {} } as never,
      new URL("http://x/api/agents/other/acp?token=pk_token"),
      "other",
      { kind: "acp", permission: "sessions" },
    );
    expect(admitted).toEqual({ ok: false, kind: "not-owner" });
    const refusal = cap.records().find((r) => r.msg === "ws.owner_mismatch");
    expect(refusal).toMatchObject({ actor: AGENT, actorKind: "agent" });
  });
});

describe("the keys of a deleted Agent", () => {
  // TEST_SCENARIO: an Agent is deleted while it has a key of its own and its owner has a key bound to it. The Agent's key is revoked, because it names an Agent that is gone. The owner's key stays live and only loses the binding.
  it("revokes the Agent's own key and only unbinds the owner's", async () => {
    const own = keyRow({ id: "key-own" });
    const owners = keyRow({
      id: "key-owner",
      agentId: null,
      agentIds: [AGENT, "agent-b"],
    });
    const rows = [own, owners];
    const cleanup = createAgentKeysCleanup({
      revokeOwn: async (agentId) => {
        for (const row of rows)
          if (row.agentId === agentId) row.revokedAt = new Date(1);
      },
      unbind: async (agentId) => {
        for (const row of rows)
          row.agentIds = row.agentIds?.filter((id) => id !== agentId) ?? null;
      },
    });
    await cleanup(AGENT);
    expect(own.revokedAt).not.toBeNull();
    expect(owners.revokedAt).toBeNull();
    expect(owners.agentIds).toEqual(["agent-b"]);
  });
});

describe("issuing a key that belongs to an Agent", () => {
  function issuer(owned: readonly string[] = [AGENT]) {
    const rows: ApiKeyRow[] = [];
    const revoked: string[] = [];
    const issue = createAgentKeyIssuer({
      insert: async (row: NewApiKey) => {
        const stored: ApiKeyRow = {
          ...row,
          createdAt: new Date(0),
          lastUsedAt: null,
          revokedAt: null,
        };
        rows.push(stored);
        return stored;
      },
      revoke: async (id) => {
        const row = rows.find((r) => r.id === id && r.revokedAt === null);
        if (!row) return false;
        row.revokedAt = new Date(1);
        revoked.push(id);
        return true;
      },
      mintToken: () => ({ token: "pk_agent_token", hash: "hash-1" }),
      isAgentOwnedBy: async (agentId, ownerSub) =>
        ownerSub === OWNER && owned.includes(agentId),
    });
    return { issue, rows, revoked };
  }

  // TEST_SCENARIO: the platform issues the key of an opted-in Agent. The key belongs to that Agent, is bound to it alone and reads it and nothing else, so an Agent that holds it can neither reach another Agent nor change anything.
  it("issues a key bound to the Agent alone, with the read scope only", async () => {
    const { issue, rows } = issuer();
    const issued = await issue.issue({
      ownerSub: OWNER,
      agentId: AGENT,
      name: "helper's key",
    });
    expect(issued).toEqual({
      ok: true,
      value: { id: rows[0]!.id, plaintext: "pk_agent_token" },
    });
    expect(rows[0]).toMatchObject({
      ownerSub: OWNER,
      agentId: AGENT,
      agentIds: [AGENT],
      scopes: ["agents:read"],
      expiresAt: null,
    });
  });

  // TEST_SCENARIO: a key is an Agent's identity only for that Agent's owner. An Agent of someone else, or one that is gone, gets no key and nothing is written.
  it("refuses an Agent its caller does not own", async () => {
    const { issue, rows } = issuer([]);
    expect(
      await issue.issue({ ownerSub: OWNER, agentId: AGENT, name: "x" }),
    ).toEqual({ ok: false, error: "not-owned" });
    expect(rows).toEqual([]);
  });

  // TEST_SCENARIO: revoking is done once and a second revoke of the same key is a no-op, so a retried opt-out or delete does not fail.
  it("revokes a key once, and a second revoke does nothing", async () => {
    const { issue, revoked } = issuer();
    const issued = await issue.issue({
      ownerSub: OWNER,
      agentId: AGENT,
      name: "x",
    });
    if (!issued.ok) throw new Error("not issued");
    await issue.revoke({ ownerSub: OWNER, id: issued.value.id });
    await issue.revoke({ ownerSub: OWNER, id: issued.value.id });
    expect(revoked).toEqual([issued.value.id]);
  });
});
