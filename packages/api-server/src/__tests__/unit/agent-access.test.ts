// TEST_OVERVIEW: Agent access to Environments from the Agent's side: every ordinary Agent on an install that serves Environments gets the platform's Environments egress rule and an Agent Key, the key's hash in the database and its plaintext in a Secret only its gateway mounts. The owner's removal of the rule withdraws the key and is never undone by the platform; restoring the rule issues a new key, so the old one opens nothing.
import { describe, expect, it } from "vitest";
import { PLATFORM_ENVIRONMENTS_SOURCE } from "api-server-api";
import {
  createAgentKeyCodec,
  isAgentKey,
} from "../../modules/agent-keys/domain/agent-key.js";
import { createAgentAccess } from "../../modules/agent-keys/services/agent-access.js";
import type { EgressRuleRow } from "../../modules/egress-rules/domain/types.js";

function world(domain: string | null = "env.example.com") {
  const rules: EgressRuleRow[] = [];
  const hashes = new Map<string, { agentId: string; ownerSub: string }>();
  const byAgent = new Map<string, string>();
  const secrets = new Map<string, { host: string; key: string }>();
  const codec = createAgentKeyCodec("pepper");
  const access = createAgentAccess({
    domain,
    codec,
    keys: {
      put: async (agentId, ownerSub, hash) => {
        const old = byAgent.get(agentId);
        if (old) hashes.delete(old);
        byAgent.set(agentId, hash);
        hashes.set(hash, { agentId, ownerSub });
      },
      findByHash: async (hash) => hashes.get(hash) ?? null,
      has: async (agentId) => byAgent.has(agentId),
      delete: async (agentId) => {
        const old = byAgent.get(agentId);
        if (old) hashes.delete(old);
        byAgent.delete(agentId);
      },
      listAgentIds: async () => [...byAgent.keys()],
    },
    secrets: {
      write: async (agentId, _owner, host, key) => void secrets.set(agentId, { host, key }),
      delete: async (agentId) => void secrets.delete(agentId),
      listAgentIds: async () => [...secrets.keys()],
    },
    rules: {
      platformRule: async (agentId) => {
        const mine = rules.filter(
          (r) => r.agentId === agentId && r.source === PLATFORM_ENVIRONMENTS_SOURCE,
        );
        return {
          active: mine.find((r) => r.status === "active") ?? null,
          everHeld: mine.length > 0,
        };
      },
      insert: async (row) => {
        const stored = {
          ...row,
          decidedAt: new Date(),
          status: "active",
        } as EgressRuleRow;
        rules.push(stored);
        return stored;
      },
    },
  });
  const removeRule = (agentId: string) => {
    for (const r of rules) if (r.agentId === agentId) r.status = "revoked";
  };
  return { access, rules, secrets, removeRule };
}

describe("Agent access to Environments", () => {
  // TEST_SCENARIO: a new Agent is created on an install that serves Environments. It gets an allow rule for the environments domain, labelled as the platform's, and a key: the Secret holds the key and names the domain, and the key resolves to the Agent.
  it("gives a new Agent the platform rule and a key that names it", async () => {
    const { access, rules, secrets } = world();
    await access.issue("agent-a", "alice");

    expect(rules).toMatchObject([
      {
        agentId: "agent-a",
        host: "*.env.example.com",
        method: "*",
        pathPattern: "*",
        verdict: "allow",
        source: PLATFORM_ENVIRONMENTS_SOURCE,
      },
    ]);
    const secret = secrets.get("agent-a")!;
    expect(secret.host).toBe("*.env.example.com");
    expect(isAgentKey(secret.key)).toBe(true);
    expect(await access.resolve(secret.key)).toEqual({ agentId: "agent-a", ownerSub: "alice" });
    expect(await access.state("agent-a")).toEqual({ state: "active", host: "*.env.example.com" });
  });

  // TEST_SCENARIO: the issue pass runs again, at the next start or periodically. An Agent that has its rule and key gets nothing new: its key stays the one its gateway holds.
  it("issues once", async () => {
    const { access, rules, secrets } = world();
    await access.issue("agent-a", "alice");
    const key = secrets.get("agent-a")!.key;
    await access.issue("agent-a", "alice");
    expect(rules).toHaveLength(1);
    expect(secrets.get("agent-a")!.key).toBe(key);
  });

  // TEST_SCENARIO: the owner removed the rule. The key and its Secret go, the old key names nobody, and the platform never adds the rule back on its own; restoring it adds a new rule and a new key, and the old key still opens nothing.
  it("withdraws the key with the rule and never re-adds a removed rule", async () => {
    const { access, rules, secrets, removeRule } = world();
    await access.issue("agent-a", "alice");
    const oldKey = secrets.get("agent-a")!.key;

    removeRule("agent-a");
    await access.withdraw("agent-a");
    expect(secrets.has("agent-a")).toBe(false);
    expect(await access.resolve(oldKey)).toBeNull();
    await access.issue("agent-a", "alice");
    expect(secrets.has("agent-a")).toBe(false);
    expect(await access.state("agent-a")).toEqual({ state: "removed", host: "*.env.example.com" });

    const restored = await access.restore("agent-a", "alice");
    expect(restored).toMatchObject({ status: "active", source: PLATFORM_ENVIRONMENTS_SOURCE });
    expect(rules.filter((r) => r.status === "active")).toHaveLength(1);
    const newKey = secrets.get("agent-a")!.key;
    expect(newKey).not.toBe(oldKey);
    expect(await access.resolve(newKey)).toEqual({ agentId: "agent-a", ownerSub: "alice" });
    expect(await access.resolve(oldKey)).toBeNull();
  });

  // TEST_SCENARIO: an install that serves no Environments gives no Agent a rule or a key, and its owners see the rule as unavailable.
  it("does nothing on an install without Environments", async () => {
    const { access, rules, secrets } = world(null);
    await access.issue("agent-a", "alice");
    expect(rules).toEqual([]);
    expect(secrets.size).toBe(0);
    expect(await access.state("agent-a")).toEqual({ state: "unavailable" });
    expect(await access.restore("agent-a", "alice")).toBeNull();
  });

  // TEST_SCENARIO: a value in the key header that is not a key's shape costs no lookup; a key is the prefix and 32 random bytes, base64url.
  it("tells a key by its shape", () => {
    expect(isAgentKey(createAgentKeyCodec("p").mint().key)).toBe(true);
    for (const v of [undefined, "", "ak_short", `pk_${"a".repeat(43)}`, `ak_${"a".repeat(43)}!`])
      expect(isAgentKey(v)).toBe(false);
  });
});
