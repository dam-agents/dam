// TEST_OVERVIEW: Agent-management API keys can create with a known provider without listing credentials; invalid providers fail before any agent or registry credential is persisted.
import { describe, expect, it, vi } from "vitest";
import type {
  ApiContext,
  Connection,
  ConnectionAuthConfig,
  TemplateSpec,
} from "api-server-api";
import { appRouter } from "api-server-api/router";
import { markTermsProven } from "api-server-api/trpc";
import { createAgentsService } from "../../modules/agents/services/agents-service.js";
import { parseInfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";
import { createConnectionsService } from "../../modules/connections/services/connections-service.js";
import {
  attachProviderToBareAgents,
  connectionGrantProvisioner,
} from "../../modules/agents/compose.js";

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

function setup(
  rows: Connection[] = [provider],
  templates: Record<string, Partial<TemplateSpec>> = {},
) {
  const connections = createConnectionsService({
    harnesses: { default: "claude-code", harnesses: [] },
    isOwnedAgent: async () => true,
    ownerId: "owner-1",
    repo: unused<ConnectionsDeps["repo"]>({
      get: async (id: string, owner: string) =>
        rows.find((c) => c.id === id && c.ownerId === owner) ?? null,
      listByOwner: async () => rows,
      listByOwnerOldestFirst: async () => rows,
    }),
    templates: unused(),
    secretStore: unused(),
    fanOut: unused(),
    oauthFlow: unused(),
    oauthEngine: unused(),
    githubAppEngine: unused(),
    s3CredentialProbe: unused(),
    providerBalance: unused(),
    credentialProbe: unused(),
    providerKeyProbe: unused(),
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
  const defaultProviders = vi.fn(async (): Promise<string[]> => []);
  const agents = createAgentsService({
    defaultHarness: "claude-code",
    owner: "owner-1",
    repo: unused<AgentsDeps["repo"]>({
      list: async () => [],
      create: persist,
    }),
    agentEnvRepo: unused<AgentsDeps["agentEnvRepo"]>({ replace: writeEnv }),
    registrySecretPort: unused<AgentsDeps["registrySecretPort"]>({
      create: writeRegistry,
      secretName: () => "registry",
    }),
    secretRefs: unused(),
    agentDefaultLimits: { cpu: "1", memory: "1Gi" },
    agentIdleTimeoutMinutes: 5,
    cleanupHooks: [],
    readTemplateSpec: async (id) =>
      templates[id] ? { spec: templates[id] as TemplateSpec } : null,
    runtimeMutator: unused<AgentsDeps["runtimeMutator"]>({ bump: runtimeBump }),
    contributionsProgress: unused(),
    agentServiceStatus: unused(),
    grantProvisioner: {
      async resolveSpecGrants(sel) {
        if (sel.providerConnectionId)
          await connections.validateProviderConnection(
            sel.providerConnectionId,
          );
        return { grantedConnectionIds: sel.connectionIds };
      },
      defaultProviders,
      applyAfterCreate: applyGrants,
    },
    listChannelsByOwner: async () => new Map(),
    listChannelsByAgent: async () => [],
    deleteChannelByType: async () => {},
    deleteSlackChannelByAgent: async () => false,
    deleteChannelsByAgentIds: async () => {},
    unitOfWork: unused(),
    channelsTxRepo: unused(),
    resolveSlackWorkspace: async () => ({ kind: "unknown" }),
    findSlackBindings: async () => [],
    onboardingChecklists: { readMany: async () => new Map() },
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
    defaultProviders,
    connections,
    agents,
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

describe("the harness and default provider a new agent gets", () => {
  const defaultTemplate = { image: "platform/default:latest" };
  const templates = {
    default: defaultTemplate,
    codex: defaultTemplate,
    mine: { image: "example.com/mine:latest" },
  };

  /** TEST_SCENARIO: A caller still sending a retired per-harness template id
   * lands on the one default template and keeps the harness that id named,
   * and the default provider is chosen for that harness. */
  it("keeps the harness a retired template id named", async () => {
    const { caller, persist, defaultProviders } = setup([], templates);
    await caller.agents.create({ name: "a", templateId: "codex" });
    expect(persist.mock.calls[0]?.[0]).toMatchObject({ harness: "codex" });
    expect(defaultProviders).toHaveBeenCalledWith([], { harness: "codex" });
  });

  /** TEST_SCENARIO: An install that ships no default template has nothing
   * to create an agent from when the caller names neither a template nor an
   * image, and says so instead of reporting a template the caller never named. */
  it("asks for a template or an image when the install has no default", async () => {
    const { caller } = setup([], {});
    await expect(caller.agents.create({ name: "a" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("templateId or an image"),
    });
  });

  /** TEST_SCENARIO: The default template names no harness; the agent gets the
   * install's default one. */
  it("gives the default template the install's default harness", async () => {
    const { caller, persist } = setup([], templates);
    await caller.agents.create({ name: "a" });
    expect(persist.mock.calls[0]?.[0]).toMatchObject({
      harness: "claude-code",
    });
  });

  /** TEST_SCENARIO: An operator template that names no harness keeps naming
   * none, so nothing downstream mistakes its image for Claude. Create asks for
   * no provider, so it still gets the default one, among the providers the
   * template lists. */
  it("leaves a custom template without a harness alone", async () => {
    const { caller, persist, defaultProviders } = setup([], {
      mine: { image: "example.com/mine:latest", providers: ["openai"] },
    });
    await caller.agents.create({ name: "a", templateId: "mine" });
    expect(persist.mock.calls[0]?.[0]?.harness).toBeUndefined();
    expect(defaultProviders).toHaveBeenCalledWith([], {
      providers: ["openai"],
    });
  });

  /** TEST_SCENARIO: A create from an image picks no template and so takes no
   * default provider; it holds only what the caller names. */
  it("grants no default provider to an image create", async () => {
    const { caller, defaultProviders } = setup([], templates);
    await caller.agents.create({ name: "a", image: "example.com/x:1" });
    expect(defaultProviders).not.toHaveBeenCalled();
  });

  /** TEST_SCENARIO: A sub-agent receives only the connections its spawn
   * names, so its creation never takes the owner's default provider. */
  it("grants no default provider to a create that opts out", async () => {
    const { agents, persist, defaultProviders } = setup([], templates);
    await agents.create({ name: "a", noDefaultProvider: true });
    expect(persist).toHaveBeenCalledOnce();
    expect(defaultProviders).not.toHaveBeenCalled();
  });

  /** TEST_SCENARIO: The default provider is one the agent's harness can run
   * on, so an owner whose first provider serves only another harness still
   * gets a usable grant. */
  it("picks a default provider the harness fits", async () => {
    const openai = { ...provider, id: "conn-openai", templateId: "openai" };
    const { connections } = setup([provider, openai]);
    expect(
      await connections.defaultProviderConnections((t) => t === "openai"),
    ).toEqual(["conn-openai"]);
    expect(
      await connections.defaultProviderConnections((t) => t === "bob"),
    ).toEqual([]);
  });

  /** TEST_SCENARIO: The fitting providers come at most one per alias, since
   * an alias names one provider in every qualified model name; of two, the
   * older wins. They come in alias order, the harness's home provider first. */
  it("lists the oldest fitting provider of each alias, in alias order", async () => {
    const ibm = { ...provider, id: "conn-ibm", templateId: "ibm-litellm" };
    const second = { ...provider, id: "conn-anthropic-2" };
    const { connections } = setup([provider, ibm, second]);
    expect(await connections.defaultProviderConnections(() => true)).toEqual([
      "conn-ibm",
      "conn-provider",
    ]);
    expect(
      await connections.defaultProviderConnections(() => true, "claude-code"),
    ).toEqual(["conn-provider", "conn-ibm"]);
  });

  /** TEST_SCENARIO: An owner holding an IBM and an Anthropic provider creates
   * an agent. It gets one provider, the one its default resolves to (Claude
   * Code's home provider), not both: with two, the default its runtime saves
   * at its first hello would have no model, and the agent's onboarding turn
   * would never run (#5578). */
  it("grants a new agent one provider, the one its default runs on", async () => {
    const ibm = { ...provider, id: "conn-ibm", templateId: "ibm-litellm" };
    const { connections } = setup([ibm, provider]);
    const provisioner = connectionGrantProvisioner(
      { ...connections, listConnections: async () => [] },
      {
        harnesses: [
          {
            name: "claude-code",
            displayName: "Claude",
            providers: ["ibm-litellm", "anthropic"],
            tags: [],
            experimental: false,
          },
        ],
      },
    );
    expect(
      await provisioner.defaultProviders([], { harness: "claude-code" }),
    ).toEqual(["conn-provider"]);
  });
});

describe("the default provider's fit", () => {
  it("skips subscription OAuth when choosing Pi's default Anthropic connection", async () => {
    const oauth = { ...provider, id: "oauth", templateId: "anthropic-oauth" };
    const key = { ...provider, id: "key", templateId: "anthropic" };
    const { connections } = setup([oauth, key]);
    const provisioner = connectionGrantProvisioner(
      { ...connections, listConnections: async () => [] },
      {
        harnesses: [
          {
            name: "pi",
            displayName: "Pi",
            providers: ["anthropic"],
            tags: [],
            experimental: false,
          },
        ],
      },
    );
    expect(await provisioner.defaultProviders([], { harness: "pi" })).toEqual([
      "key",
    ]);
  });

  const openai = { ...provider, id: "conn-openai", templateId: "openai" };
  const provisioner = () => {
    const { connections } = setup([provider, openai]);
    return connectionGrantProvisioner(
      { ...connections, listConnections: async () => [] },
      {
        harnesses: [
          {
            name: "codex",
            displayName: "Codex",
            providers: ["openai"],
            tags: [],
            experimental: false,
          },
        ],
      },
    );
  };

  /** TEST_SCENARIO: A catalog harness takes a provider it runs on. */
  it("follows the catalog for a harness it lists", async () => {
    expect(
      await provisioner().defaultProviders([], { harness: "codex" }),
    ).toEqual(["conn-openai"]);
  });

  /** TEST_SCENARIO: A custom template's own harness, such as the e2e mock, is
   * not in the catalog; it takes the first provider the template lists, or
   * the first of any. */
  it("follows the template for a harness the catalog does not list", async () => {
    expect(
      await provisioner().defaultProviders([], { harness: "mock" }),
    ).toEqual(["conn-provider"]);
    expect(
      await provisioner().defaultProviders([], {
        harness: "mock",
        providers: ["openai"],
      }),
    ).toEqual(["conn-openai"]);
  });
});

describe("attachProviderToBareAgents", () => {
  const attach = async (owned: Connection[], connectionId: string) => {
    const { connections } = setup(owned);
    const grants: Record<string, string[]> = {
      bare: [],
      held: [owned[0]!.id],
      environment: [],
    };
    const granted: string[] = [];
    const deps = {
      ...connections,
      listConnections: async () => owned,
      getAgentConnections: async (agentId: string) => ({
        agentId,
        connections: grants[agentId]!.map((id) => ({
          connectionId: id,
          grantedAt: "",
          preferred: false,
        })),
      }),
      updateAgentConnections: async (agentId: string) => {
        granted.push(agentId);
      },
    } as unknown as Parameters<typeof attachProviderToBareAgents>[0];
    const agents = [
      { id: "bare", spec: {} },
      { id: "held", spec: {} },
      { id: "environment", spec: { environmentOf: "bare" } },
    ];
    await attachProviderToBareAgents(
      deps,
      { harnesses: [] },
      agents,
      connectionId,
    );
    return granted;
  };
  const old = { ...provider, id: "old" };

  /** TEST_SCENARIO: A user's first agent is created before they connect a
   * provider, so it holds none. Connecting one gives it to that agent, so its
   * first message has a model key; an agent that already holds a provider is
   * left as it is, and an Environment, which holds none either, never gets
   * the owner's provider. */
  it("gives the owner's first provider to agents that hold none", async () => {
    expect(await attach([old], "old")).toEqual(["bare"]);
  });

  /** TEST_SCENARIO: An agent holding no provider while the owner already has
   * one was detached on purpose, so a later provider, of the same alias or
   * another, does not land on it. */
  it("leaves an agent detached on purpose without a provider", async () => {
    const fresh = { ...provider, id: "fresh" };
    const other = { ...provider, id: "other", templateId: "openai" };
    expect(await attach([old, fresh], "fresh")).toEqual([]);
    expect(await attach([old, other], "other")).toEqual([]);
  });
});
