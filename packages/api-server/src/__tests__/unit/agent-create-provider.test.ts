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
import {
  configureLogger,
  getLogger,
  type LogLevel,
} from "../../core/logger.js";
import {
  parseInfraAgent,
  type InfraAgent,
} from "../../modules/agents/infrastructure/agent-mappers.js";
import { createAgentsService } from "../../modules/agents/services/agents-service.js";
import { createConnectionsService } from "../../modules/connections/services/connections-service.js";
import { buildCatalog } from "../../modules/connections/domain/catalog.js";
import { createConnectionTemplateRegistry } from "../../modules/connections/domain/connection-template.js";
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

const dam: Connection = {
  id: "conn-dam",
  ownerId: "owner-1",
  templateId: "dam",
  name: "DAM",
  inputs: {},
  auth: {
    kind: "header",
    valueRef: { storeId: "test", path: "dam", field: "value" },
    headerName: "Authorization",
    valueFormat: "Bearer {value}",
  },
  contributions: [],
};

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
  opts: { damOffered?: boolean } = {},
) {
  const connections = createConnectionsService({
    damConnectionOffered: async () => opts.damOffered ?? true,
    harnesses: { default: "claude-code", harnesses: [] },
    isOwnedAgent: async () => true,
    ownerId: "owner-1",
    repo: unused<ConnectionsDeps["repo"]>({
      get: async (id: string, owner: string) =>
        rows.find((c) => c.id === id && c.ownerId === owner) ?? null,
      listByOwner: async () => rows,
      listByOwnerOldestFirst: async () => rows,
    }),
    templates: createConnectionTemplateRegistry(
      buildCatalog(
        {},
        {
          damBaseUrl: "http://dam-apiserver.default.svc.cluster.local:4000",
          brandName: "Test",
        },
      ),
    ),
    damKey: {
      mint: async () => ({ id: "key-1", plaintext: "pk_secret" }),
      revoke: async () => {},
      active: async (ids: readonly string[]) => new Set(ids),
      ledger: {
        queue: async () => {},
        settle: async () => {},
        pendingFor: async () => [],
        forget: async () => {},
      },
    },
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
  // TEST_OVERVIEW: the store refuses a duplicate id and lists what it holds, so a retry resumes the Agent it already has under the same name rather than making a second one.
  const persisted = new Map<string, InfraAgent>();
  const persist = vi.fn(
    async (spec: Record<string, unknown>, owner: string, id: string) => {
      if (persisted.has(id)) throw new Error(`${id} already exists`);
      const agent = parseInfraAgent({
        metadata: { name: id, labels: { "agent-platform.ai/owner": owner } },
        spec,
      });
      persisted.set(id, agent);
      return agent;
    },
  );
  const writeRegistry = vi.fn(async () => {});
  const applyGrants = vi.fn(async () => {});
  const writeEnv = vi.fn(async () => {});
  const runtimeBump = vi.fn(async () => 1);
  const defaultProviders = vi.fn(
    async (): Promise<{
      ids: string[];
      source: "kit" | "template" | "harness";
    }> => ({ ids: [], source: "harness" }),
  );
  const bind = vi.fn(async (_agentId: string): Promise<string | null> => null);
  const newAgentDefault = vi.fn(
    async (): Promise<{
      name: string | null;
      model: string;
      harness: string;
      connectionId: string;
      bind: typeof bind;
    } | null> => null,
  );
  const agents = createAgentsService({
    defaultHarness: "claude-code",
    owner: "owner-1",
    actor: "owner-1",
    repo: unused<AgentsDeps["repo"]>({
      list: async () => [...persisted.values()],
      create: persist,
      get: async (id: string) => persisted.get(id) ?? null,
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
      resolveSpecGrants: connectionGrantProvisioner(connections, {
        harnesses: [],
      }).resolveSpecGrants,
      defaultProviders,
      applyAfterCreate: applyGrants,
    },
    newAgentDefault,
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
    editors: unused<AgentsDeps["editors"]>(),
    editorEmail: null,
    resolveUserEmail: async () => null,
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
    newAgentDefault,
    bind,
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

describe("the default profile a new agent starts on", () => {
  const templates = { default: { image: "platform/default:latest" } };
  const byTemplate = { name: "test-agent", templateId: "default" };
  const onPi = (bind: ReturnType<typeof setup>["bind"]) => ({
    name: "Default",
    model: "cb/some-model",
    harness: "pi",
    connectionId: "conn-profile",
    bind,
  });

  /** TEST_SCENARIO: An owner's default for new agents decides a new agent's
   * harness and its one provider in place of the harness's provider order,
   * and the agent's chat default is bound to it, so a default exists before
   * the first hello and the onboarding turn has a model to run on (#5578). */
  it("starts on the default profile, with its provider alone", async () => {
    const { caller, newAgentDefault, defaultProviders, bind, persist } = setup(
      [provider],
      templates,
    );
    newAgentDefault.mockResolvedValue(onPi(bind));
    defaultProviders.mockResolvedValue({
      ids: ["conn-first-in-order"],
      source: "harness",
    });
    const created = await caller.agents.create(byTemplate);
    expect(created.grantedConnectionIds).toEqual(["conn-profile"]);
    expect(persist.mock.calls[0]![0]).toMatchObject({ harness: "pi" });
    expect(bind).toHaveBeenCalledWith(created.id);
    expect(created.defaultProvider).toEqual({
      connectionId: "conn-profile",
      source: "profile",
      profile: { name: "Default", model: "cb/some-model", harness: "pi" },
    });
  });

  /** TEST_SCENARIO: An owner who chose no profile as their default for new
   * agents starts a new agent on values (the base default or their own): its
   * one provider and chat default come from them as from a profile, and the
   * answer says the default chose it, with no profile name. */
  it("starts on the base default and says so", async () => {
    const { caller, newAgentDefault, defaultProviders, bind } = setup(
      [provider],
      templates,
    );
    newAgentDefault.mockResolvedValue({ ...onPi(bind), name: null });
    defaultProviders.mockResolvedValue({
      ids: ["conn-first-in-order"],
      source: "harness",
    });
    const created = await caller.agents.create(byTemplate);
    expect(created.grantedConnectionIds).toEqual(["conn-profile"]);
    expect(bind).toHaveBeenCalledWith(created.id);
    expect(created.defaultProvider).toEqual({
      connectionId: "conn-profile",
      source: "default",
      profile: { name: null, model: "cb/some-model", harness: "pi" },
    });
  });

  /** TEST_SCENARIO: A create that names its harness keeps it; a default
   * profile on another harness leaves the provider order and the first-hello
   * conversion as before. */
  it("leaves an agent on another harness to the provider order", async () => {
    const { caller, newAgentDefault, defaultProviders, bind } = setup(
      [provider],
      templates,
    );
    newAgentDefault.mockResolvedValue(onPi(bind));
    defaultProviders.mockResolvedValue({
      ids: ["conn-first-in-order"],
      source: "harness",
    });
    const created = await caller.agents.create({
      ...byTemplate,
      harness: "codex",
    });
    expect(created.grantedConnectionIds).toEqual(["conn-first-in-order"]);
    expect(bind).not.toHaveBeenCalled();
    expect(created.defaultProvider).toEqual({
      connectionId: "conn-first-in-order",
      source: "harness",
      profile: null,
    });
  });

  /** TEST_SCENARIO: A create that names its provider chose it, so the answer
   * carries no default provider to explain (#6142). */
  it("says nothing of a default when the create names its provider", async () => {
    const { caller, newAgentDefault, bind } = setup([provider], templates);
    newAgentDefault.mockResolvedValue(onPi(bind));
    const created = await caller.agents.create({
      ...byTemplate,
      providerConnectionId: provider.id,
    });
    expect(created.grantedConnectionIds).toEqual([provider.id]);
    expect(created).not.toHaveProperty("defaultProvider");
  });

  /** TEST_SCENARIO: A kit that names the model its agent needs decides the
   * default, and an Environment never starts a session, so neither asks for
   * the default profile. */
  it("stays out of a kit that names the model and of an environment", async () => {
    const { agents, newAgentDefault } = setup([provider], templates);
    await agents.create({
      ...byTemplate,
      providerConnectionId: provider.id,
      starterKitDefaultModel: "cb/some-model",
    });
    await agents.create({
      ...byTemplate,
      name: "test-agent-environment",
      providerConnectionId: provider.id,
      environmentOf: "agent-root",
    });
    expect(newAgentDefault).not.toHaveBeenCalled();
  });

  /** TEST_SCENARIO: A kit that lists its providers decides the agent's
   * provider as one that names its model does, so the default profile stays
   * out, the provider order hears the kit's list, and the answer says the
   * kit's list chose, not the harness order (#6142). */
  it("leaves a kit that lists its providers to that list", async () => {
    const { agents, newAgentDefault, defaultProviders } = setup(
      [provider],
      templates,
    );
    defaultProviders.mockResolvedValue({ ids: ["conn-ibm"], source: "kit" });
    const created = await agents.create({
      ...byTemplate,
      starterKitProviders: ["ibm-litellm"],
    });
    expect(newAgentDefault).not.toHaveBeenCalled();
    expect(defaultProviders).toHaveBeenCalledWith([], {
      harness: "claude-code",
      preferred: ["ibm-litellm"],
    });
    expect(created.defaultProvider).toEqual({
      connectionId: "conn-ibm",
      source: "kit",
      profile: null,
    });
  });

  /** TEST_SCENARIO: A failed binding is not a failed create; the first-hello
   * conversion still gives the agent a default, and the log says why the
   * agent missed the default profile, whether the binder threw or declined. */
  it.each([
    ["throws", () => Promise.reject(new Error("boom")), "boom"],
    [
      "declines",
      () => Promise.resolve("the agent already holds a chat default"),
      "the agent already holds a chat default",
    ],
  ])(
    "does not fail the create, and logs why, when the binder %s",
    async (_how, outcome, reason) => {
      const lines: string[] = [];
      const level = getLogger().level as LogLevel;
      configureLogger({ level: "warn", write: (line) => lines.push(line) });
      try {
        const { caller, newAgentDefault, bind, persist } = setup(
          [provider],
          templates,
        );
        newAgentDefault.mockResolvedValue(onPi(bind));
        bind.mockImplementationOnce(outcome);
        await expect(caller.agents.create(byTemplate)).resolves.toMatchObject({
          name: "test-agent",
        });
        expect(persist).toHaveBeenCalledOnce();
        expect(
          lines
            .map((line) => JSON.parse(line) as { reason?: string; msg: string })
            .find((entry) => entry.msg.includes("default for new agents")),
        ).toMatchObject({ reason });
      } finally {
        configureLogger({ level });
      }
    },
  );
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
    ).toEqual({ ids: ["conn-provider"], source: "harness" });
  });

  /** TEST_SCENARIO: A starter kit whose engine needs one gateway lists it,
   * and an owner who holds it gets it ahead of the harness's home provider;
   * an owner who holds none of the kit's list still gets the harness's
   * first, so the list never blocks a create (#6040). */
  it("grants a provider the kit lists first, else the harness's first", async () => {
    const ibm = { ...provider, id: "conn-ibm", templateId: "ibm-litellm" };
    const provisionerFor = (rows: Connection[]) => {
      const { connections } = setup(rows);
      return connectionGrantProvisioner(
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
    };
    const kitWants = { harness: "claude-code", preferred: ["ibm-litellm"] };
    expect(
      await provisionerFor([ibm, provider]).defaultProviders([], kitWants),
    ).toEqual({ ids: ["conn-ibm"], source: "kit" });
    expect(
      await provisionerFor([provider]).defaultProviders([], kitWants),
    ).toEqual({ ids: ["conn-provider"], source: "harness" });
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
    expect(await provisioner.defaultProviders([], { harness: "pi" })).toEqual({
      ids: ["key"],
      source: "harness",
    });
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
    ).toEqual({ ids: ["conn-openai"], source: "harness" });
  });

  /** TEST_SCENARIO: A custom template's own harness, such as the e2e mock, is
   * not in the catalog; it takes the first provider the template lists, or
   * the first of any. */
  it("follows the template for a harness the catalog does not list", async () => {
    expect(
      await provisioner().defaultProviders([], { harness: "mock" }),
    ).toEqual({ ids: ["conn-provider"], source: "harness" });
    expect(
      await provisioner().defaultProviders([], {
        harness: "mock",
        providers: ["openai"],
      }),
    ).toEqual({ ids: ["conn-openai"], source: "template" });
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

describe("the flag that offers the install's own connection", () => {
  // TEST_SCENARIO: an Agent that already holds it spawns a child naming it while the owner's flag is off, so the child's create is refused before anything is written — no Agent, no registry Secret, no grant — as the person's own create would be.
  it("refuses a spawn that names it while the flag is off", async () => {
    const { caller, persist, writeRegistry } = setup(
      [provider, dam],
      {},
      { damOffered: false },
    );
    await expect(
      caller.agents.create({ ...input, connectionIds: [dam.id] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(persist).not.toHaveBeenCalled();
    expect(writeRegistry).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the platform's mark is not expressible over the API: `platformGrants` in a raw create payload is stripped by the schema, so the same request is still refused.
  it("refuses a payload that claims the platform's mark", async () => {
    const { caller, persist } = setup(
      [provider, dam],
      {},
      { damOffered: false },
    );
    await expect(
      caller.agents.create({
        ...input,
        connectionIds: [dam.id],
        platformGrants: true,
      } as never),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(persist).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the same is true where a person can make the Connection themselves: `createDam` takes no input, so a payload naming the platform's path buys nothing and the create is refused while the flag is off.
  it("refuses a createDam payload that names the platform's path", async () => {
    const { caller } = setup([provider, dam], {}, { damOffered: false });
    await expect(
      caller.connections.createDam({ platform: true } as never),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // TEST_SCENARIO: with the flag on, the same create goes through and the Agent names the grant.
  it("allows the same create while the flag is on", async () => {
    const { caller } = setup([provider, dam], {}, { damOffered: true });
    const result = await caller.agents.create({
      ...input,
      connectionIds: [dam.id],
    });
    expect(result.grantedConnectionIds).toEqual([dam.id, provider.id]);
  });
});

describe("a create the platform resumes", () => {
  // TEST_SCENARIO: an earlier attempt wrote the Agent and then failed on its bookkeeping, so the same id is asked for again: the store refuses the row, and the create finishes that Agent from there — the grants applied again, the instructions re-sent — instead of failing on the row it already has or making a second Agent.
  it("finishes the Agent an earlier attempt left half-made", async () => {
    const { agents, persist, applyGrants, runtimeBump } = setup();
    const created = await agents.create({ ...input, id: "agent-resumed" });
    expect(created.id).toBe("agent-resumed");
    expect(persist).toHaveBeenCalledTimes(1);

    applyGrants.mockClear();
    runtimeBump.mockClear();
    const again = await agents.create({ ...input, id: "agent-resumed" });
    expect(again.id).toBe("agent-resumed");
    expect(persist).toHaveBeenCalledTimes(2);
    expect(applyGrants).toHaveBeenCalledTimes(1);
    expect(runtimeBump).toHaveBeenCalled();
  });
});
