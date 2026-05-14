import { describe, it, expect } from "vitest";
import {
  type EnvMapping,
  IBM_LITELLM_DEFAULT_MODEL_PINS,
  ibmLitellmEnvMappings,
  PROVIDERS,
} from "api-server-api";

const ANTHROPIC_API_KEY_ENV_MAPPING = PROVIDERS.anthropic.modes.find((m) => m.key === "api-key")!.defaultEnvMappings[0];
const ANTHROPIC_OAUTH_ENV_MAPPING = PROVIDERS.anthropic.modes.find((m) => m.key === "oauth")!.defaultEnvMappings[0];
const IBM_LITELLM_HOST_PATTERN = PROVIDERS["ibm-litellm"].hostPattern;

import { createSecretsService } from "../../modules/secrets/services/secrets-service.js";
import type {
  K8sSecretsPort,
  K8sStoredSecret,
} from "../../modules/secrets/infrastructure/k8s-secrets-port.js";
import type {
  AgentGrants,
  AgentGrantsPort,
  GrantedAgentSummary,
} from "../../modules/agents/infrastructure/agent-grants-port.js";

interface SyncCall {
  agentId: string;
  decidedBy: string;
  grants: Map<string, { hosts: readonly { host: string; pathPattern?: string }[] }>;
  ownedSourceIds: ReadonlySet<string>;
}

function makePort(initial: K8sStoredSecret[]) {
  const store = new Map(initial.map((s) => [s.id, s]));
  const created: {
    id: string;
    name: string;
    envMappings?: EnvMapping[];
    primarySecretId?: string;
    injectionConfig?: K8sStoredSecret["injectionConfig"];
  }[] = [];
  const updated: { id: string; patch: Record<string, unknown> }[] = [];
  const deleted: string[] = [];
  const port: K8sSecretsPort = {
    async listSecrets() {
      return Array.from(store.values());
    },
    async createSecret(input) {
      created.push({
        id: input.id,
        name: input.name,
        envMappings: input.envMappings,
        primarySecretId: input.primarySecretId,
        injectionConfig: input.injectionConfig,
      });
      store.set(input.id, {
        id: input.id,
        name: input.name,
        type: input.type,
        hostPattern: input.hostPattern,
        ...(input.pathPattern ? { pathPattern: input.pathPattern } : {}),
        ...(input.envMappings ? { envMappings: input.envMappings } : {}),
        ...(input.injectionConfig ? { injectionConfig: input.injectionConfig } : {}),
        ...(input.authMode ? { authMode: input.authMode } : {}),
        ...(input.primarySecretId ? { primarySecretId: input.primarySecretId } : {}),
        createdAt: new Date().toISOString(),
      });
    },
    async updateSecret(id, patch) {
      const before = store.get(id);
      if (!before) return null;
      updated.push({ id, patch });
      const after: K8sStoredSecret = {
        ...before,
        ...(patch.hostPattern !== undefined ? { hostPattern: patch.hostPattern } : {}),
        ...(patch.pathPattern !== undefined && patch.pathPattern !== null
          ? { pathPattern: patch.pathPattern }
          : {}),
        ...(patch.envMappings !== undefined ? { envMappings: patch.envMappings } : {}),
        ...(patch.injectionConfig !== undefined && patch.injectionConfig !== null
          ? { injectionConfig: patch.injectionConfig }
          : {}),
      };
      if (patch.pathPattern === null) delete (after as { pathPattern?: string }).pathPattern;
      store.set(id, after);
      return { before, after };
    },
    async deleteSecret(id) {
      deleted.push(id);
      store.delete(id);
    },
  };
  return { port, store, created, updated, deleted };
}

function makeGrants(initial: GrantedAgentSummary[] = []) {
  const bumps: { cmName: string; hash: string }[] = [];
  const secretGrantCalls: { agentId: string; secretIds: readonly string[] }[] = [];
  const port: AgentGrantsPort = {
    async get(): Promise<AgentGrants> {
      return { grantedSecretIds: [], grantedConnectionIds: [] };
    },
    async setSecretGrants(agentId, secretIds) {
      secretGrantCalls.push({ agentId, secretIds });
    },
    async setConnectionGrants() {},
    async listAgentsGrantedSecret() {
      return initial;
    },
    async bumpSecretsRev(cmName, hash) {
      bumps.push({ cmName, hash });
    },
  };
  return { port, bumps, secretGrantCalls };
}

function makeSyncRecorder() {
  const calls: SyncCall[] = [];
  return {
    calls,
    syncForAgent: async (input: SyncCall) => {
      calls.push(input);
    },
  };
}

describe("PROVIDERS registry shape", () => {
  it("every entry has at least one mode and each mode has at least one envMapping", () => {
    for (const [id, preset] of Object.entries(PROVIDERS)) {
      expect(preset.id, `${id}.id mismatches the registry key`).toBe(id);
      expect(preset.modes.length, `${id} has no modes`).toBeGreaterThan(0);
      expect(preset.hostPattern, `${id} hostPattern empty`).toBeTruthy();
      for (const mode of preset.modes) {
        expect(mode.key, `${id}.${mode.key} key empty`).toBeTruthy();
        expect(
          mode.defaultEnvMappings.length,
          `${id}.${mode.key} has no defaultEnvMappings`,
        ).toBeGreaterThan(0);
      }
    }
  });
});

describe("secrets-service.create — Anthropic envMappings default (ADR-040)", () => {
  it("defaults to ANTHROPIC_API_KEY mapping for api-key value", async () => {
    const { port, created } = makePort([]);
    const { port: grants } = makeGrants();
    const svc = createSecretsService({
      k8sPort: port,
      grants,
      ownerSub: "owner-1",
    });
    await svc.create({
      type: "anthropic",
      name: "Anthropic",
      value: "sk-ant-api03-foo",
    });
    expect(created[0]!.envMappings).toEqual([ANTHROPIC_API_KEY_ENV_MAPPING]);
  });

  it("defaults to CLAUDE_CODE_OAUTH_TOKEN mapping for oauth value", async () => {
    const { port, created } = makePort([]);
    const { port: grants } = makeGrants();
    const svc = createSecretsService({
      k8sPort: port,
      grants,
      ownerSub: "owner-1",
    });
    await svc.create({
      type: "anthropic",
      name: "Anthropic OAuth",
      value: "sk-ant-oat01-foo",
    });
    expect(created[0]!.envMappings).toEqual([ANTHROPIC_OAUTH_ENV_MAPPING]);
  });

  it("respects caller-supplied envMappings over the default", async () => {
    const { port, created } = makePort([]);
    const { port: grants } = makeGrants();
    const svc = createSecretsService({
      k8sPort: port,
      grants,
      ownerSub: "owner-1",
    });
    const userMappings: EnvMapping[] = [
      { envName: "CUSTOM_KEY", placeholder: "ph" },
    ];
    await svc.create({
      type: "anthropic",
      name: "Anthropic",
      value: "sk-ant-api03-foo",
      envMappings: userMappings,
    });
    expect(created[0]!.envMappings).toEqual(userMappings);
  });

  it("defaults the 13-entry env bundle for ibm-litellm secrets", async () => {
    const { port, created, store } = makePort([]);
    const { port: grants } = makeGrants();
    const svc = createSecretsService({
      k8sPort: port,
      grants,
      ownerSub: "owner-1",
    });
    const view = await svc.create({
      type: "ibm-litellm",
      name: "IBM LiteLLM ETE Proxy",
      value: "sk-litellm-foo",
    });
    expect(created[0]!.envMappings).toEqual(ibmLitellmEnvMappings());
    // Spot-check the bundle: credential placeholder, the BASE_URL pin
    // (must mirror the host pattern), and a default model pin.
    const envByName = new Map(
      created[0]!.envMappings!.map((m) => [m.envName, m.placeholder]),
    );
    expect(envByName.get("ANTHROPIC_AUTH_TOKEN")).toBe("sk-dummy");
    expect(envByName.get("ANTHROPIC_BASE_URL")).toBe(
      `https://${IBM_LITELLM_HOST_PATTERN}`,
    );
    expect(envByName.get("ANTHROPIC_DEFAULT_OPUS_MODEL")).toBe(
      IBM_LITELLM_DEFAULT_MODEL_PINS.opus,
    );
    // pi-agent SPECS slot is also primed so the same secret configures pi.
    expect(envByName.get("OPENAI_PROXY_URL")).toBe(
      `https://${IBM_LITELLM_HOST_PATTERN}`,
    );
    // SecretView must round-trip the new type instead of collapsing to "generic".
    expect(view.type).toBe("ibm-litellm");
    expect(store.get(view.id)!.hostPattern).toBe(IBM_LITELLM_HOST_PATTERN);
  });

  it("respects caller-supplied envMappings on ibm-litellm (form-driven model overrides)", async () => {
    const { port, created } = makePort([]);
    const { port: grants } = makeGrants();
    const svc = createSecretsService({
      k8sPort: port,
      grants,
      ownerSub: "owner-1",
    });
    const overridden = ibmLitellmEnvMappings({
      ...IBM_LITELLM_DEFAULT_MODEL_PINS,
      opus: "aws/claude-opus-4-7",
    });
    await svc.create({
      type: "ibm-litellm",
      name: "IBM LiteLLM ETE Proxy",
      value: "sk-litellm-foo",
      envMappings: overridden,
    });
    expect(created[0]!.envMappings).toEqual(overridden);
    expect(
      created[0]!.envMappings!.find((m) => m.envName === "ANTHROPIC_DEFAULT_OPUS_MODEL")?.placeholder,
    ).toBe("aws/claude-opus-4-7");
  });

  it("defaults the OPENAI_API_KEY env mapping + /v1/* path for openai secrets", async () => {
    const { port, created, store } = makePort([]);
    const { port: grants } = makeGrants();
    const svc = createSecretsService({
      k8sPort: port,
      grants,
      ownerSub: "owner-1",
    });
    const view = await svc.create({
      type: "openai",
      name: "OpenAI",
      value: "sk-test-foo",
    });
    expect(created[0]!.envMappings).toEqual(
      PROVIDERS.openai.modes[0].defaultEnvMappings,
    );
    expect(created[0]!.envMappings![0].envName).toBe("OPENAI_API_KEY");
    // Path scope is auto-applied so /v1/* is the only Envoy chain
    // matching this credential, not other endpoints on api.openai.com.
    expect(store.get(view.id)!.pathPattern).toBe("/v1/*");
    expect(store.get(view.id)!.hostPattern).toBe(PROVIDERS.openai.hostPattern);
    expect(view.type).toBe("openai");
  });

  it("does not default envMappings for generic secrets", async () => {
    const { port, created } = makePort([]);
    const { port: grants } = makeGrants();
    const svc = createSecretsService({
      k8sPort: port,
      grants,
      ownerSub: "owner-1",
    });
    await svc.create({
      type: "generic",
      name: "Custom",
      value: "tok",
      hostPattern: "api.example.com",
    });
    expect(created[0]!.envMappings).toBeUndefined();
  });
});

describe("secrets-service.update — fanout (ADR-040)", () => {
  function setup(opts: { secret: K8sStoredSecret; granted?: GrantedAgentSummary[] }) {
    const { port, updated } = makePort([opts.secret]);
    const { port: grants, bumps } = makeGrants(opts.granted ?? []);
    const sync = makeSyncRecorder();
    const svc = createSecretsService({
      k8sPort: port,
      grants,
      connectionRules: { syncForAgent: sync.syncForAgent },
      ownerSub: "owner-1",
    });
    return { svc, updated, bumps, syncCalls: sync.calls };
  }

  const baseSecret: K8sStoredSecret = {
    id: "secret-x",
    name: "My Secret",
    type: "generic",
    hostPattern: "api.example.com",
    envMappings: [{ envName: "FOO", placeholder: "ph" }],
    createdAt: "2026-01-01T00:00:00Z",
  };

  it("host change → calls syncForAgent only; no agent-pod roll (ADR-040 §Fanout: hot)", async () => {
    const { svc, bumps, syncCalls } = setup({
      secret: baseSecret,
      granted: [
        { agentId: "agent-a", instanceCmNames: ["a-inst"], grantedSecretIds: ["secret-x"] },
        { agentId: "agent-b", instanceCmNames: ["b-inst-1", "b-inst-2"], grantedSecretIds: ["secret-x"] },
      ],
    });
    await svc.update({ id: "secret-x", hostPattern: "api.new.example" });
    expect(syncCalls.map((c) => c.agentId).sort()).toEqual(["agent-a", "agent-b"]);
    expect(bumps).toHaveLength(0);
  });

  it("host AND env change → both fanouts run", async () => {
    const { svc, bumps, syncCalls } = setup({
      secret: baseSecret,
      granted: [
        { agentId: "agent-a", instanceCmNames: ["a-inst"], grantedSecretIds: ["secret-x"] },
      ],
    });
    await svc.update({
      id: "secret-x",
      hostPattern: "api.new.example",
      envMappings: [{ envName: "BAR", placeholder: "ph2" }],
    });
    expect(syncCalls).toHaveLength(1);
    expect(bumps).toHaveLength(1);
  });

  it("envMappings change → bumps secrets-rev only (host fanout skipped)", async () => {
    const { svc, bumps, syncCalls } = setup({
      secret: baseSecret,
      granted: [
        { agentId: "agent-a", instanceCmNames: ["a-inst"], grantedSecretIds: ["secret-x"] },
      ],
    });
    await svc.update({
      id: "secret-x",
      envMappings: [{ envName: "BAR", placeholder: "ph2" }],
    });
    expect(syncCalls).toHaveLength(0);
    expect(bumps).toHaveLength(1);
    expect(bumps[0]!.cmName).toBe("a-inst");
  });

  it("name-only edit → no fanout", async () => {
    const { svc, bumps, syncCalls } = setup({
      secret: baseSecret,
      granted: [
        { agentId: "agent-a", instanceCmNames: ["a-inst"], grantedSecretIds: ["secret-x"] },
      ],
    });
    await svc.update({ id: "secret-x", name: "Renamed" });
    expect(syncCalls).toHaveLength(0);
    expect(bumps).toHaveLength(0);
  });

  it("no granted agents → no fanout even on render-affecting edit", async () => {
    const { svc, bumps, syncCalls } = setup({
      secret: baseSecret,
      granted: [],
    });
    await svc.update({
      id: "secret-x",
      envMappings: [{ envName: "BAR", placeholder: "ph2" }],
    });
    expect(syncCalls).toHaveLength(0);
    expect(bumps).toHaveLength(0);
  });
});

describe("secrets-service.listGrantedAgents (ADR-040)", () => {
  it("joins granted agentIds with display names from listOwnedAgentSummaries", async () => {
    const { port } = makePort([]);
    const { port: grants } = makeGrants([
      { agentId: "agent-a", instanceCmNames: ["a-inst"], grantedSecretIds: ["secret-x"] },
      { agentId: "agent-b", instanceCmNames: ["b-inst"], grantedSecretIds: ["secret-x"] },
    ]);
    const svc = createSecretsService({
      k8sPort: port,
      grants,
      ownerSub: "owner-1",
      listOwnedAgentSummaries: async () => [
        { id: "agent-a", name: "Alpha" },
        { id: "agent-b", name: "Beta" },
      ],
    });
    const result = await svc.listGrantedAgents("secret-x");
    expect(result).toEqual([
      { id: "agent-a", name: "Alpha" },
      { id: "agent-b", name: "Beta" },
    ]);
  });

  it("falls back to agentId as name when summary lookup fails", async () => {
    const { port } = makePort([]);
    const { port: grants } = makeGrants([
      { agentId: "agent-a", instanceCmNames: ["a-inst"], grantedSecretIds: ["secret-x"] },
    ]);
    const svc = createSecretsService({
      k8sPort: port,
      grants,
      ownerSub: "owner-1",
    });
    const result = await svc.listGrantedAgents("secret-x");
    expect(result).toEqual([{ id: "agent-a", name: "agent-a" }]);
  });

  it("returns empty array when the secret is not granted", async () => {
    const { port } = makePort([]);
    const { port: grants } = makeGrants([]);
    const svc = createSecretsService({
      k8sPort: port,
      grants,
      ownerSub: "owner-1",
    });
    expect(await svc.listGrantedAgents("secret-x")).toEqual([]);
  });
});

describe("secrets-service — extraInjections (twin secrets, e.g. Bob)", () => {
  it("create() mints a twin per extraInjections entry, linked via primarySecretId", async () => {
    const { port, created, store } = makePort([]);
    const { port: grants } = makeGrants();
    const svc = createSecretsService({
      k8sPort: port,
      grants,
      ownerSub: "owner-1",
    });
    const view = await svc.create({
      type: "bob",
      name: "Bob Shell",
      value: "sk-bob-foo",
    });
    // Two K8s Secrets created: the primary + one twin from Bob's
    // `extraInjections` registry entry.
    expect(created).toHaveLength(2);
    const [primary, twin] = created;
    expect(primary!.id).toBe(view.id);
    expect(primary!.primarySecretId).toBeUndefined();
    expect(twin!.primarySecretId).toBe(view.id);
    expect(twin!.injectionConfig?.queryParamName).toBe("key");
    expect(twin!.injectionConfig?.headerName).toBe("X-Bobshell-Internal");
    // The twin has no env mappings — credentials only, env is the primary's job.
    expect(twin!.envMappings).toBeUndefined();
    // K8s store carries the link annotation so subsequent reads can find twins.
    const twinStored = store.get(twin!.id);
    expect(twinStored?.primarySecretId).toBe(view.id);
  });

  it("list() hides twins from the user-facing view", async () => {
    const { port } = makePort([]);
    const { port: grants } = makeGrants();
    const svc = createSecretsService({
      k8sPort: port,
      grants,
      ownerSub: "owner-1",
    });
    await svc.create({ type: "bob", name: "Bob Shell", value: "sk-bob-foo" });
    const view = await svc.list();
    expect(view).toHaveLength(1);
    expect(view[0]!.type).toBe("bob");
  });

  it("update({ value }) cascades the new value onto every twin", async () => {
    const { port, updated } = makePort([]);
    const { port: grants } = makeGrants();
    const svc = createSecretsService({
      k8sPort: port,
      grants,
      ownerSub: "owner-1",
    });
    const view = await svc.create({ type: "bob", name: "Bob Shell", value: "sk-bob-foo" });
    await svc.update({ id: view.id, value: "sk-bob-rotated" });
    // Primary + twin both got the new value.
    const valueUpdates = updated.filter((u) => u.patch.value === "sk-bob-rotated");
    expect(valueUpdates).toHaveLength(2);
    expect(valueUpdates.map((u) => u.id).sort()).toEqual(
      [view.id, ...valueUpdates.filter((u) => u.id !== view.id).map((u) => u.id)].sort(),
    );
  });

  it("update({ hostPattern }) cascades onto twins; envMappings does NOT", async () => {
    const { port, updated } = makePort([]);
    const { port: grants } = makeGrants();
    const svc = createSecretsService({
      k8sPort: port,
      grants,
      ownerSub: "owner-1",
    });
    const view = await svc.create({ type: "bob", name: "Bob Shell", value: "sk-bob-foo" });
    const hostBefore = updated.length;
    await svc.update({
      id: view.id,
      hostPattern: "alt.bob.ibm.com",
      envMappings: [{ envName: "BOBSHELL_API_KEY", placeholder: "ph" }, { envName: "BOB_SHELL_MODEL", placeholder: "premium-shell" }],
    });
    const cascaded = updated.slice(hostBefore);
    // Primary update + twin host cascade. The twin must NOT receive
    // envMappings — twins have none by design.
    const twinUpdates = cascaded.filter((u) => u.id !== view.id);
    expect(twinUpdates).toHaveLength(1);
    expect(twinUpdates[0]!.patch.envMappings).toBeUndefined();
    expect(twinUpdates[0]!.patch.hostPattern).toBe("alt.bob.ibm.com");
  });

  it("delete() removes twins before the primary", async () => {
    const { port, deleted } = makePort([]);
    const { port: grants } = makeGrants();
    const svc = createSecretsService({
      k8sPort: port,
      grants,
      ownerSub: "owner-1",
    });
    const view = await svc.create({ type: "bob", name: "Bob Shell", value: "sk-bob-foo" });
    await svc.delete(view.id);
    // Two deletes; primary is last so we don't leave dangling twins on failure.
    expect(deleted).toHaveLength(2);
    expect(deleted[deleted.length - 1]).toBe(view.id);
  });

  it("setAgentAccess expands primary IDs to include their twins in the K8s grant", async () => {
    const { port } = makePort([]);
    const { port: grants, secretGrantCalls } = makeGrants();
    const svc = createSecretsService({
      k8sPort: port,
      grants,
      ownerSub: "owner-1",
    });
    const view = await svc.create({ type: "bob", name: "Bob Shell", value: "sk-bob-foo" });
    await svc.setAgentAccess("agent-a", { secretIds: [view.id] });
    expect(secretGrantCalls).toHaveLength(1);
    const persistedIds = secretGrantCalls[0]!.secretIds;
    expect(persistedIds).toContain(view.id);
    // Twin IDs come along for the ride so the controller mounts both.
    expect(persistedIds.length).toBe(2);
  });

  it("getAgentAccess hides twin IDs from the user view", async () => {
    const { port } = makePort([]);
    const svc = createSecretsService({
      k8sPort: port,
      grants: {
        async get() {
          return { grantedSecretIds: [], grantedConnectionIds: [] };
        },
        async setSecretGrants() {},
        async setConnectionGrants() {},
        async listAgentsGrantedSecret() {
          return [];
        },
        async bumpSecretsRev() {},
      },
      ownerSub: "owner-1",
    });
    const view = await svc.create({ type: "bob", name: "Bob Shell", value: "sk-bob-foo" });
    // Stub `grants.get` to return the expanded list (primary + twin).
    const allSecrets = await port.listSecrets();
    const twinId = allSecrets.find((s) => s.primarySecretId === view.id)!.id;
    const svc2 = createSecretsService({
      k8sPort: port,
      grants: {
        async get() {
          return {
            grantedSecretIds: [view.id, twinId],
            grantedConnectionIds: [],
          };
        },
        async setSecretGrants() {},
        async setConnectionGrants() {},
        async listAgentsGrantedSecret() {
          return [];
        },
        async bumpSecretsRev() {},
      },
      ownerSub: "owner-1",
    });
    const access = await svc2.getAgentAccess("agent-a");
    expect(access.secretIds).toEqual([view.id]);
  });

  it("setAgentAccess with empty list revokes both primary and twin grants", async () => {
    const { port } = makePort([]);
    const { port: grants, secretGrantCalls } = makeGrants();
    const svc = createSecretsService({
      k8sPort: port,
      grants,
      ownerSub: "owner-1",
    });
    await svc.create({ type: "bob", name: "Bob Shell", value: "sk-bob-foo" });
    await svc.setAgentAccess("agent-a", { secretIds: [] });
    expect(secretGrantCalls).toHaveLength(1);
    expect(secretGrantCalls[0]!.secretIds).toEqual([]);
  });

  it("setAgentAccess silently drops twin IDs passed in the input", async () => {
    const { port } = makePort([]);
    const { port: grants, secretGrantCalls } = makeGrants();
    const svc = createSecretsService({
      k8sPort: port,
      grants,
      ownerSub: "owner-1",
    });
    const view = await svc.create({ type: "bob", name: "Bob Shell", value: "sk-bob-foo" });
    const all = await port.listSecrets();
    const twinId = all.find((s) => s.primarySecretId === view.id)!.id;
    // Caller passes a twin ID by mistake → must be filtered out, so a lone
    // twin can't be granted without its primary.
    await svc.setAgentAccess("agent-a", { secretIds: [twinId] });
    expect(secretGrantCalls[0]!.secretIds).toEqual([]);
  });

  it("create() rolls the primary back if a twin write fails", async () => {
    const { port, store } = makePort([]);
    // Wrap createSecret so any twin (one with primarySecretId set) throws —
    // the primary succeeds, the twin fails, and the cleanup pass must
    // leave the store empty.
    const originalCreate = port.createSecret;
    port.createSecret = async (input) => {
      if (input.primarySecretId) throw new Error("twin write boom");
      await originalCreate.call(port, input);
    };
    const { port: grants } = makeGrants();
    const svc = createSecretsService({
      k8sPort: port,
      grants,
      ownerSub: "owner-1",
    });
    await expect(
      svc.create({ type: "bob", name: "Bob Shell", value: "sk-bob-foo" }),
    ).rejects.toThrow("twin write boom");
    expect(store.size).toBe(0);
  });
});
