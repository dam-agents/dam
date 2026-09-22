// TEST_OVERVIEW: Agent-management API keys can create with a known provider without listing credentials; invalid providers fail before any agent or registry credential is persisted.
import { describe, expect, it, vi } from "vitest";
import type {
  ApiContext,
  Connection,
  ConnectionAuthConfig,
} from "api-server-api";
import { appRouter } from "api-server-api/router";
import { markTermsProven } from "api-server-api/trpc";
import { createAgentsService } from "../../modules/agents/services/agents-service.js";
import { parseInfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";
import { createConnectionsService } from "../../modules/connections/services/connections-service.js";

type AgentsDeps = Parameters<typeof createAgentsService>[0];
type ConnectionsDeps = Parameters<typeof createConnectionsService>[0];

function unused<T extends object>(fields: Partial<T> = {}): T {
  return new Proxy(fields, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected dependency: ${String(key)}`);
    },
  }) as T;
}

const provider: Connection = {
  id: "conn-provider",
  ownerId: "owner-1",
  templateId: "anthropic",
  name: "My provider",
  inputs: {},
  auth: {
    kind: "header",
    valueRef: { storeId: "test", path: "provider", field: "value" },
    headerName: "x-api-key",
    valueFormat: "{value}",
  },
  contributions: [],
};

function oauthAuth(
  overrides: Partial<Extract<ConnectionAuthConfig, { kind: "oauth" }>> = {},
): ConnectionAuthConfig {
  return {
    kind: "oauth",
    clientId: "client",
    accessTokenRef: { storeId: "test", path: "provider", field: "value" },
    scopes: [],
    tokenUrl: "https://example.com/token",
    authorizationUrl: "https://example.com/authorize",
    ...overrides,
  };
}

function setup(rows: Connection[] = [provider]) {
  const connections = createConnectionsService({
    ownerId: "owner-1",
    repo: unused<ConnectionsDeps["repo"]>({
      get: async (id: string, owner: string) =>
        rows.find((c) => c.id === id && c.ownerId === owner) ?? null,
    }),
    templates: unused(),
    secretStore: unused(),
    fanOut: unused(),
    oauthFlow: unused(),
    oauthEngine: unused(),
    githubAppEngine: unused(),
    oauthCallbackUrl: "https://example.com/callback",
    brandName: "Test",
    connectionLock: (_key, fn) => fn(),
    resolveKbShare: async () => null,
  });
  const persist = vi.fn(
    async (spec: Record<string, unknown>, owner: string, id: string) =>
      parseInfraAgent({
        metadata: { name: id, labels: { "agent-platform.ai/owner": owner } },
        spec,
      }),
  );
  const writeRegistry = vi.fn(async () => {});
  const applyGrants = vi.fn(async () => {});
  const writeEnv = vi.fn(async () => {});
  const runtimeBump = vi.fn(async () => 1);
  const agents = createAgentsService({
    owner: "owner-1",
    repo: unused<AgentsDeps["repo"]>({ create: persist }),
    agentEnvRepo: unused<AgentsDeps["agentEnvRepo"]>({ replace: writeEnv }),
    registrySecretPort: unused<AgentsDeps["registrySecretPort"]>({
      create: writeRegistry,
      secretName: () => "registry",
    }),
    agentDefaultLimits: { cpu: "1", memory: "1Gi" },
    agentIdleTimeoutMinutes: 30,
    cleanupHooks: [],
    readTemplateSpec: async () => null,
    runtimeMutator: unused<AgentsDeps["runtimeMutator"]>({ bump: runtimeBump }),
    contributionsProgress: unused(),
    podStatus: unused(),
    resizeLock: (_key, fn) => fn(),
    grantProvisioner: {
      async resolveSpecGrants(sel) {
        if (sel.providerConnectionId)
          await connections.validateProviderConnection(
            sel.providerConnectionId,
          );
        return { grantedConnectionIds: sel.connectionIds };
      },
      applyAfterCreate: applyGrants,
    },
    listChannelsByOwner: async () => new Map(),
    listChannelsByAgent: async () => [],
    upsertChannel: async () => {},
    deleteChannelByType: async () => {},
    deleteSlackChannelByAgent: async () => false,
    deleteChannelsByAgentIds: async () => {},
    unitOfWork: unused(),
    channelsTxRepo: unused(),
    resolveSlackWorkspace: async () => ({ kind: "unknown" }),
    findSlackBindings: async () => [],
    onboardingChecklists: { readMany: async () => new Map() },
    avatars: unused(),
  });
  const ctx = unused<ApiContext>({
    agents,
    connections,
    user: {
      sub: "owner-1",
      preferredUsername: "test",
      scopes: ["agents:manage"],
      agentIds: "*",
      keyId: "key-1",
    },
  });
  markTermsProven(ctx);
  return {
    caller: appRouter.createCaller(ctx),
    persist,
    writeRegistry,
    applyGrants,
    writeEnv,
    runtimeBump,
  };
}

const input = {
  name: "test-agent",
  image: "example.com/agent:latest",
  providerConnectionId: provider.id,
  registryCredential: {
    server: "example.com",
    username: "test",
    password: "test",
  },
};

describe("agent creation with a designated provider", () => {
  it("allows an agents:manage key to use a provider while denying connection listing", async () => {
    const { caller, persist, applyGrants } = setup();
    await expect(caller.connections.list()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const result = await caller.agents.create(input);
    expect(result.grantedConnectionIds).toEqual([provider.id]);
    expect(persist).toHaveBeenCalledOnce();
    expect(applyGrants).toHaveBeenCalledWith(
      result.id,
      expect.objectContaining({ connectionIds: [provider.id] }),
    );
  });

  it.each([
    { label: "missing", rows: [], code: "BAD_REQUEST" },
    {
      label: "another owner's",
      rows: [{ ...provider, ownerId: "owner-2" }],
      code: "BAD_REQUEST",
    },
    {
      label: "non-provider",
      rows: [{ ...provider, templateId: "github" }],
      code: "BAD_REQUEST",
    },
    {
      label: "pending",
      rows: [{ ...provider, auth: oauthAuth() }],
      code: "BAD_REQUEST",
    },
    {
      label: "expired",
      rows: [
        { ...provider, auth: oauthAuth({ connectedAt: 1, expiresAt: 1 }) },
      ],
      code: "BAD_REQUEST",
    },
    {
      label: "refresh-rejected",
      rows: [
        {
          ...provider,
          auth: oauthAuth({ connectedAt: 1, refreshFailedAt: 1 }),
        },
      ],
      code: "BAD_REQUEST",
    },
  ])("rejects a $label provider before any writes", async ({ rows, code }) => {
    const {
      caller,
      persist,
      writeRegistry,
      applyGrants,
      writeEnv,
      runtimeBump,
    } = setup(rows);
    await expect(caller.agents.create(input)).rejects.toMatchObject({ code });
    expect(persist).not.toHaveBeenCalled();
    expect(writeRegistry).not.toHaveBeenCalled();
    expect(applyGrants).not.toHaveBeenCalled();
    expect(writeEnv).not.toHaveBeenCalled();
    expect(runtimeBump).not.toHaveBeenCalled();
  });

  it("merges the provider with other grants without duplicating it", async () => {
    const { caller, applyGrants } = setup();
    const result = await caller.agents.create({
      ...input,
      connectionIds: [provider.id, "conn-github", provider.id],
    });
    expect(result.grantedConnectionIds).toEqual([provider.id, "conn-github"]);
    expect(applyGrants).toHaveBeenCalledWith(
      result.id,
      expect.objectContaining({ connectionIds: [provider.id, "conn-github"] }),
    );
  });

  it("preserves creation without a provider for other API callers", async () => {
    const { caller } = setup([]);
    const result = await caller.agents.create({
      name: "test-agent",
      image: input.image,
    });
    expect(result.grantedConnectionIds).toEqual([]);
  });
});
