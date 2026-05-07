import { describe, it, expect } from "vitest";
import {
  ANTHROPIC_API_KEY_ENV_MAPPING,
  ANTHROPIC_OAUTH_ENV_MAPPING,
  type EnvMapping,
} from "api-server-api";

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
  const created: { id: string; envMappings?: EnvMapping[] }[] = [];
  const updated: { id: string; patch: Record<string, unknown> }[] = [];
  const port: K8sSecretsPort = {
    async listSecrets() {
      return Array.from(store.values());
    },
    async createSecret(input) {
      created.push({ id: input.id, envMappings: input.envMappings });
      store.set(input.id, {
        id: input.id,
        name: input.name,
        type: input.type,
        hostPattern: input.hostPattern,
        ...(input.pathPattern ? { pathPattern: input.pathPattern } : {}),
        ...(input.envMappings ? { envMappings: input.envMappings } : {}),
        ...(input.injectionConfig ? { injectionConfig: input.injectionConfig } : {}),
        ...(input.authMode ? { authMode: input.authMode } : {}),
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
      store.delete(id);
    },
  };
  return { port, store, created, updated };
}

function makeGrants(initial: GrantedAgentSummary[] = []) {
  const bumps: { cmName: string; hash: string }[] = [];
  const port: AgentGrantsPort = {
    async get(): Promise<AgentGrants> {
      return { grantedSecretIds: [], grantedConnectionIds: [] };
    },
    async setSecretGrants() {},
    async setConnectionGrants() {},
    async listAgentsGrantedSecret() {
      return initial;
    },
    async bumpSecretsRev(cmName, hash) {
      bumps.push({ cmName, hash });
    },
  };
  return { port, bumps };
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
