import { describe, it, expect, afterEach, vi } from "vitest";
import {
  CONFIGURE_SESSION_METHOD,
  NO_MODEL_REASON,
  PIN_MODEL_METHOD,
  type SessionDefaultsEventPayload,
} from "agent-runtime-api";
import {
  IDLE_REAP_DELAY_MS,
  createClient,
  createHarness,
  createInMemoryUndeliveredStore,
  createSessionMetadata,
  frames,
  memoryDocumentBackend,
  keepsEveryTask,
  promptTextsOf,
  type Frame,
  type Harness,
} from "./acp-world.js";
import { createAcpRuntime } from "../acp-runtime.js";
import {
  noopAgentRequests,
  type AgentRequestObserver,
} from "../pending-agent-requests.js";
import { createActiveTurnStore } from "../../../infrastructure/active-turn-store.js";
import { createContinuedFromStore } from "../../../infrastructure/continued-from-store.js";
import type { SessionDefaultsStore } from "../../../infrastructure/session-defaults-store.js";
import { createBackgroundWorkRegistry } from "../../background-work-registry.js";
import {
  createModelCatalog,
  type ModelCatalog,
  VENDORED_PRICE_TABLE,
} from "../../../../model-catalog/index.js";
import type { ModelDiscovery } from "../../../../runtime-channel/infrastructure/model-discovery.js";
import type { RuntimeEnvState } from "../../../../runtime-channel/infrastructure/env-state-store.js";
import type { ModelRouterBinding } from "../../../../runtime-channel/manifest.js";
import {
  automaticModelOf,
  modelUsableOn,
} from "../../../domain/catalog-model.js";
import {
  createLeaseRouter,
  PROVIDER_REMOVED_REASON,
  type LeasePair,
} from "../../lease-router.js";
import { createTriggerSessionDriver } from "../../trigger-session-driver.js";

/**
 * TEST_OVERVIEW: one agent, one harness process per harness.
 *
 * Every model call goes through the Model Router by the session's model
 * name, so the runtime holds one harness process per (harness, process-scoped
 * settings), whatever providers and models its sessions use. A session's
 * model is a per-turn choice: kept in its metadata, sent to the harness as
 * its own per-session call before the next prompt and after every cold load,
 * and changeable mid-turn. There is no default lease: a process starts on the
 * first frame naming a session on its harness and goes away once it has held
 * no session for a while, while a client's initialize and session/list are
 * answered without any process. A session whose model names a provider the
 * agent no longer holds is refused on its next prompt, not frozen. One client
 * connection reaches every process, so a question two harnesses ask with the
 * same request id must still be answered to the harness that asked it, from
 * whichever connection answers it.
 */

const IDLE_CHECK_MS = 10_000;
const LEASE_IDLE_MS = 60_000;
const MODEL_WAIT_MS = 15_000;

const SESSION_SETTINGS: Record<string, "process" | "session"> = {
  mode: "session",
  cacheTtl: "process",
  subagentModel: "process",
};

const ALIAS_OF: Record<string, string> = {
  "conn-a": "ibm",
  "conn-b": "cb",
  "conn-ibm": "ibm",
  "conn-cb": "cb",
  "conn-bedrock": "bedrock",
};

const HARNESSES: Record<string, ModelRouterBinding | undefined> = {
  "claude-code": {
    dialects: ["anthropic-messages"],
    namePrefix: "claude/",
    lowercaseNames: true,
    native: { templates: ["bedrock"], models: ["opus", "sonnet"] },
  },
  codex: { dialects: ["openai-responses"] },
  pi: {
    dialects: ["anthropic-messages", "openai-chat", "openai-responses"],
    native: { templates: ["bedrock"], models: "listed" },
  },
};

const curveBender = (contextWindow: string) => ({
  id: "conn-cb",
  template: "curve-bender",
  env: {
    OPENAI_BASE_URL: "https://cb.example",
    OPENAI_API_KEY: "platform:conn:conn-cb",
    OPENAI_PROXY_CONTEXT_WINDOW: contextWindow,
  },
});

const IBM = {
  id: "conn-ibm",
  template: "ibm-litellm",
  env: {
    OPENAI_BASE_URL: "https://ibm.example",
    OPENAI_API_KEY: "platform:conn:conn-ibm",
    OPENAI_PROXY_CONTEXT_WINDOW: "200000",
  },
};

function catalogFor(
  layers: () => RuntimeEnvState["providers"],
  models: () => string[],
): ModelCatalog {
  const discover = (async () => {
    const entries = models().map((id) => ({ id, name: id }));
    return {
      status: "observed" as const,
      models: entries.map((e) => ({ value: e.id, name: e.id })),
      entries,
      via: "test",
    };
  }) as ModelDiscovery;
  return createModelCatalog({
    envState: () => ({ env: {}, providers: layers(), harnesses: [] }),
    envReady: () => true,
    discover,
    harnesses: HARNESSES,
    table: VENDORED_PRICE_TABLE,
    log: () => {},
  });
}

function createLeaseWorld(opts: {
  providers: string[];
  agentRequests?: AgentRequestObserver;
  modelRequired?: boolean | (() => boolean);
  modelWaitMs?: number;
  catalog?: ModelCatalog;
  sessionDefaults?: SessionDefaultsStore;
}) {
  let providers = opts.providers;
  let keptProcesses = 0;
  let openLinks = 0;
  const granted = () => providers.map((p) => ALIAS_OF[p] ?? p);
  const metadata = createSessionMetadata();
  const harnesses = new Map<string, Harness[]>();
  const key = (pair: LeasePair): string =>
    `${pair.harness}${pair.settings?.cacheTtl ? `/cache-${pair.settings.cacheTtl}` : ""}${pair.settings?.subagentModel ? `/subagent-${pair.settings.subagentModel}` : ""}${pair.native ? `/native-${pair.native}` : ""}${pair.env ? `/env-${Object.keys(pair.env).join(",")}` : ""}`;
  const backgroundWork = createBackgroundWorkRegistry({
    keepPolicy: keepsEveryTask,
  });
  const router = createLeaseRouter({
    defaultHarness: "claude-code",
    harnessKnown: (h) => ["claude-code", "codex", "pi"].includes(h),
    providerAliases: granted,
    aliasOfConnection: (id) => ALIAS_OF[id] ?? null,
    nativeConnectionOf: (harness, model) =>
      harness === "claude-code" &&
      model?.startsWith("bedrock/") &&
      providers.includes("conn-bedrock")
        ? "conn-bedrock"
        : null,
    modelEnvOf: (harness, model, settings) =>
      harness === "claude-code" &&
      [model, settings?.subagentModel].some((m) => m?.includes("/gpt-"))
        ? { CLAUDE_CODE_AUTO_MODE_SERVER: "0" }
        : undefined,
    modelRequired: () =>
      typeof opts.modelRequired === "function"
        ? opts.modelRequired()
        : opts.modelRequired === true,
    ...(opts.modelWaitMs && { modelWaitMs: opts.modelWaitMs }),
    ...(opts.catalog && {
      modelUsable: (harness, model) =>
        modelUsableOn(opts.catalog!, harness, model, granted()),
      automaticModel: (harness, preferAliases) =>
        automaticModelOf(opts.catalog!, harness, preferAliases, granted()),
      onCatalogChange: (listener) => opts.catalog!.onChange(listener),
    }),
    ...(opts.sessionDefaults && { sessionDefaults: opts.sessionDefaults }),
    settingScope: (_harness, id) => SESSION_SETTINGS[id] ?? null,
    settingsError: (_harness, settings) =>
      Object.keys(settings).some((id) => !SESSION_SETTINGS[id])
        ? "unsupported setting"
        : undefined,
    initializeFor: (harness) =>
      harness === "claude-code"
        ? { agentCapabilities: { loadSession: true }, authMethods: [] }
        : null,
    listSessions: (isRunning) => ({
      sessions: Object.entries(metadata.store.all()).map(([sessionId]) => ({
        sessionId,
        running: isRunning(sessionId),
      })),
    }),
    sessionMetadata: metadata.store,
    backgroundWork,
    keepPolicy: {
      keptProcessCount: () => keptProcesses,
      openLinkCount: () => openLinks,
    },
    idleCheckMs: IDLE_CHECK_MS,
    leaseIdleMs: LEASE_IDLE_MS,
    log: () => {},
    agentRequests: opts.agentRequests ?? noopAgentRequests,
    createRuntime: (pair, scoped) =>
      createAcpRuntime({
        agentRequests: scoped.agentRequests,
        workingDir: "/workspace",
        idleReapDelayMs: IDLE_REAP_DELAY_MS,
        onArtifactTouch: () => {},
        undeliveredPrompts: createInMemoryUndeliveredStore(),
        continuedFrom: createContinuedFromStore(memoryDocumentBackend(), () =>
          new Date().toISOString(),
        ),
        activeTurns: createActiveTurnStore(memoryDocumentBackend()),
        sessionMetadata: metadata.store,
        backgroundWork: scoped.backgroundWork,
        onHarnessExited: scoped.onHarnessExited,
        modeSettingId: "mode",
        sessionSettingFrames: (sessionId) => {
          const meta = metadata.store.get(sessionId)?.meta;
          const model = router.sessionChoice(sessionId).model;
          return [
            ...(model
              ? [
                  {
                    method: "session/set_config_option",
                    params: { sessionId, configId: "model", value: model },
                    critical: true,
                  },
                ]
              : []),
            ...(meta?.settings?.mode
              ? [
                  {
                    method: "session/set_mode",
                    params: { sessionId, modeId: meta.settings.mode },
                  },
                ]
              : []),
          ];
        },
        spawnAgent: () => {
          scoped.harnessSpawned();
          const { harness, process } = createHarness();
          const spawnedAs = key(scoped.pair());
          const list = harnesses.get(spawnedAs) ?? [];
          list.push(harness);
          harnesses.set(spawnedAs, list);
          return process;
        },
      }),
  });
  return {
    router,
    metadata,
    backgroundWork,
    connect() {
      const { client, channel } = createClient();
      router.attach(channel);
      return client;
    },
    harness(k: string): Harness {
      const list = harnesses.get(k);
      const last = list?.[list.length - 1];
      if (!last) throw new Error(`no harness was started for ${k}`);
      return last;
    },
    harnessCount: (k: string) => harnesses.get(k)?.length ?? 0,
    keepProcesses(count: number) {
      keptProcesses = count;
    },
    openLinks(count: number) {
      openLinks = count;
    },
    revoke(provider: string) {
      providers = providers.filter((p) => p !== provider);
      router.applyEnvChange({
        namesChanged: true,
        base: null,
        providers: [{ id: provider, namesChanged: true }],
        harnesses: [],
      });
    },
    dropProvider(provider: string) {
      providers = providers.filter((p) => p !== provider);
    },
  };
}

function newSessionOn(id: number, platform: Record<string, string>): object {
  return {
    jsonrpc: "2.0",
    id,
    method: "session/new",
    params: { cwd: ".", _meta: { platform } },
  };
}

function startSession(
  world: ReturnType<typeof createLeaseWorld>,
  client: ReturnType<typeof createLeaseWorld>["connect"] extends () => infer C
    ? C
    : never,
  harnessKey: string,
  sessionId: string,
  id: number,
  platform: Record<string, string>,
): void {
  client.send(newSessionOn(id, platform));
  world.harness(harnessKey).replyTo("session/new", { sessionId });
}

const modelFrames = (harness: Harness, sessionId: string): string[] =>
  harness
    .received("session/set_config_option")
    .filter(
      (f) =>
        (f.params as { sessionId: string; configId: string }).sessionId ===
          sessionId && (f.params as { configId: string }).configId === "model",
    )
    .map((f) => (f.params as { value: string }).value);

describe("acp-runtime: one harness process per harness", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** TEST_SCENARIO: Two sessions on different providers' models share one
   * Claude Code process; a Codex session gets a process of its own, started
   * only when it first asks. Each session's model reaches the harness as its
   * own set_config_option before its prompt. */
  it("runs every session of a harness on one process, whatever their providers", () => {
    const world = createLeaseWorld({ providers: ["conn-a", "conn-b"] });
    const client = world.connect();
    client.send(frames.initialize(1));
    expect(world.harnessCount("claude-code")).toBe(0);
    startSession(world, client, "claude-code", "s-a", 2, {
      model: "ibm/aws/claude-opus-4-8",
    });
    startSession(world, client, "claude-code", "s-b", 3, {
      model: "cb/rits/zai-org/glm-5-3",
    });
    expect(world.harnessCount("claude-code")).toBe(1);
    const harness = world.harness("claude-code");
    harness.replyToSession("session/set_config_option", "s-a", {});
    harness.replyToSession("session/set_config_option", "s-b", {});
    client.send(frames.prompt(4, "s-b", "on b"));
    client.send(frames.prompt(5, "s-a", "on a"));
    expect(modelFrames(harness, "s-a")).toEqual(["ibm/aws/claude-opus-4-8"]);
    expect(modelFrames(harness, "s-b")).toEqual(["cb/rits/zai-org/glm-5-3"]);
    expect(promptTextsOf(harness)).toEqual(["on b", "on a"]);
    expect(world.metadata.store.get("s-b")?.meta).toMatchObject({
      harness: "claude-code",
      model: "cb/rits/zai-org/glm-5-3",
    });
    expect(world.harnessCount("codex")).toBe(0);
    startSession(world, client, "codex", "s-c", 6, { harness: "codex" });
    expect(world.harnessCount("codex")).toBe(1);
  });

  /** TEST_SCENARIO: A client's initialize is answered from the manifest's
   * declared capabilities with no harness running, plus the runtime's own
   * `runEnded` capability that `dam run` waits on, and the process a session
   * later needs is told about the client the same way, so it answers with the
   * same client capabilities while its own initialize answer never reaches
   * the client a second time. */
  it("answers initialize without a process and replays it into a later one", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const client = world.connect();
    client.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: 1, clientCapabilities: { terminal: true } },
    });
    expect(client.reply(1)?.result).toEqual({
      protocolVersion: 1,
      agentCapabilities: { loadSession: true },
      authMethods: [],
      _meta: { platform: { runEnded: true } },
    });
    expect(world.harnessCount("claude-code")).toBe(0);
    client.send(newSessionOn(2, { harness: "codex" }));
    const codex = world.harness("codex");
    expect(codex.received("initialize")[0]?.params).toEqual({
      protocolVersion: 1,
      clientCapabilities: { terminal: true },
    });
    codex.replyTo("initialize", {});
    expect(client.saw("initialize")).toEqual([]);
  });

  /** TEST_SCENARIO: session/list is answered from the session metadata, so a
   * client sees every session the agent knows without starting a harness. A
   * frame naming no session that the router cannot answer, an image's own
   * control call, starts the default harness and reaches it there. */
  it("lists sessions from the metadata without a process", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    world.metadata.store.set("old", { mode: "chat", harness: "codex" });
    const client = world.connect();
    client.send(frames.initialize(0));
    client.send({ jsonrpc: "2.0", id: 1, method: "session/list", params: {} });
    expect(client.reply(1)?.result).toEqual({
      sessions: [{ sessionId: "old", running: false }],
    });
    expect(world.harnessCount("claude-code")).toBe(0);
    expect(world.harnessCount("codex")).toBe(0);
    client.send({
      jsonrpc: "2.0",
      id: 2,
      method: "control/getEnv",
      params: {},
    });
    expect(world.harnessCount("claude-code")).toBe(1);
    expect(world.harnessCount("codex")).toBe(0);
    const claude = world.harness("claude-code");
    claude.replyTo("initialize", {});
    expect(claude.received("control/getEnv")).toHaveLength(1);
    claude.replyTo("control/getEnv", { value: "x" });
    expect(client.reply(2)?.result).toEqual({ value: "x" });
  });

  /** TEST_SCENARIO: a terminal Session's title is known only to its harness,
   * so a session/list that names a harness reaches that harness's process,
   * started for it, and no other. */
  it("asks the named harness for its listing", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const client = world.connect();
    client.send(frames.initialize(0));
    client.send({
      jsonrpc: "2.0",
      id: 1,
      method: "session/list",
      params: { cwd: ".", _meta: { platform: { harness: "codex" } } },
    });
    expect(world.harnessCount("codex")).toBe(1);
    expect(world.harnessCount("claude-code")).toBe(0);
    const codex = world.harness("codex");
    codex.replyTo("initialize", {});
    expect(codex.received("session/list")).toHaveLength(1);
  });

  /** TEST_SCENARIO: Two harnesses ask the client a question with the same
   * request id. Each answer reaches the harness that asked it. */
  it("keeps agent requests from two processes apart", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const client = world.connect();
    startSession(world, client, "claude-code", "s-a", 1, {});
    startSession(world, client, "codex", "s-c", 2, { harness: "codex" });
    world.harness("claude-code").emit(frames.requestPermission(0, "s-a"));
    world.harness("codex").emit(frames.requestPermission(0, "s-c"));
    const asked = client.saw("session/request_permission");
    expect(asked).toHaveLength(2);
    const [toA, toC] = asked as [Frame, Frame];
    expect(toA.id).not.toEqual(toC.id);

    client.send({ jsonrpc: "2.0", id: toC.id, result: { outcome: "c" } });
    client.send({ jsonrpc: "2.0", id: toA.id, result: { outcome: "a" } });
    expect(world.harness("claude-code").answersTo(0)).toEqual([
      expect.objectContaining({ result: { outcome: "a" } }),
    ]);
    expect(world.harness("codex").answersTo(0)).toEqual([
      expect.objectContaining({ result: { outcome: "c" } }),
    ]);
  });

  /** TEST_SCENARIO: The agent asks while nobody watches the session. The
   * platform hears of it under the id a client would see, and answers it later
   * from a connection of its own that never saw the question; the answer must
   * reach the harness that asked, under the id it asked with. */
  it("takes the answer to an unwatched question from any connection", () => {
    const heard: unknown[] = [];
    const world = createLeaseWorld({
      providers: ["conn-a"],
      agentRequests: {
        held: () => {},
        waiting: (id) => heard.push(id),
        answered: () => {},
        abandoned: () => {},
      },
    });
    const first = world.connect();
    startSession(world, first, "claude-code", "s-a", 1, {});
    first.disconnect();
    world.harness("claude-code").emit(frames.requestPermission(7, "s-a"));
    expect(heard).toHaveLength(1);

    const platform = world.connect();
    platform.send({ jsonrpc: "2.0", id: heard[0], result: { outcome: "x" } });
    expect(world.harness("claude-code").answersTo(7)).toEqual([
      expect.objectContaining({ result: { outcome: "x" } }),
    ]);
  });

  /** TEST_SCENARIO: The user watches the session when the agent asks, so no
   * waiting report goes out, and answers in the chat. The platform must still
   * hear the end under the id the client saw: the lease router wraps the
   * observer, and a wrapper that swallows a method leaves the record of a
   * watched request open forever. */
  it("forwards the held and answered reports of a watched question", () => {
    const heard: unknown[][] = [];
    const observer: AgentRequestObserver = {
      held: (id, sessionId) => heard.push(["held", id, sessionId]),
      waiting: (id, sessionId) => heard.push(["waiting", id, sessionId]),
      answered: (id, sessionId) => heard.push(["answered", id, sessionId]),
      abandoned: (id, sessionId) => heard.push(["abandoned", id, sessionId]),
    };
    const world = createLeaseWorld({
      providers: ["conn-a"],
      agentRequests: observer,
    });
    const viewer = world.connect();
    startSession(world, viewer, "claude-code", "s-a", 1, {});
    world.harness("claude-code").emit(frames.requestPermission(11, "s-a"));

    expect(heard.map(([kind]) => kind)).toEqual(["held"]);
    const routed = heard[0]![1];
    expect(routed).toMatch(/^platform-lease-in-[0-9a-f]+-\d+-11$/);

    viewer.send({ jsonrpc: "2.0", id: routed, result: { outcome: "x" } });
    expect(heard.map(([kind]) => kind)).toEqual(["held", "answered"]);
    expect(world.harness("claude-code").answersTo(11)).toEqual([
      expect.objectContaining({ result: { outcome: "x" } }),
    ]);
  });

  /** TEST_SCENARIO: The pod restarted, and its first harness process asks
   * again under the same request id. A verdict kept from before the restart
   * names the earlier boot's request, so it must answer nothing. */
  it("drops an answer under an id from before a restart", () => {
    const heard: unknown[] = [];
    const observer: AgentRequestObserver = {
      held: () => {},
      waiting: (id) => heard.push(id),
      answered: () => {},
      abandoned: () => {},
    };
    const before = createLeaseWorld({
      providers: ["conn-a"],
      agentRequests: observer,
    });
    const first = before.connect();
    startSession(before, first, "claude-code", "s-a", 1, {});
    first.disconnect();
    before.harness("claude-code").emit(frames.requestPermission(7, "s-a"));

    const after = createLeaseWorld({
      providers: ["conn-a"],
      agentRequests: observer,
    });
    const reopened = after.connect();
    startSession(after, reopened, "claude-code", "s-a", 1, {});
    reopened.disconnect();
    after.harness("claude-code").emit(frames.requestPermission(7, "s-a"));
    expect(heard).toHaveLength(2);
    expect(heard[1]).not.toEqual(heard[0]);

    const platform = after.connect();
    platform.send({ jsonrpc: "2.0", id: heard[0], result: { outcome: "x" } });
    expect(after.harness("claude-code").answersTo(7)).toEqual([]);
  });

  /** TEST_SCENARIO: A permission prompt is still open when the page reloads,
   * so the runtime puts the same question before the new connection, under
   * the id the first connection saw. */
  it("puts a re-sent question before a new client under the id it had", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const first = world.connect();
    startSession(world, first, "claude-code", "s-a", 1, {});
    first.send(frames.prompt(2, "s-a", "write a file"));
    world.harness("claude-code").emit(frames.requestPermission(7, "s-a"));
    const [asked] = first.saw("session/request_permission") as [Frame];

    const reloaded = world.connect();
    reloaded.send(frames.loadSession(1, "s-a"));
    const [reasked] = reloaded.saw("session/request_permission") as [Frame];
    expect(reasked.id).toEqual(asked.id);

    reloaded.send({ jsonrpc: "2.0", id: reasked.id, result: { outcome: "x" } });
    expect(world.harness("claude-code").answersTo(7)).toEqual([
      expect.objectContaining({ result: { outcome: "x" } }),
    ]);
  });

  /** TEST_SCENARIO: A recycle restarts the harness inside the same lease, and
   * the new process counts its request ids from the start again. Its question
   * must not reach the client under the id of one from the process before. */
  it("never gives a restarted harness's question the id of an earlier one", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const client = world.connect();
    startSession(world, client, "claude-code", "s-a", 1, {});
    world.harness("claude-code").emit(frames.requestPermission(7, "s-a"));
    const [before] = client.saw("session/request_permission") as [Frame];
    client.send({ jsonrpc: "2.0", id: before.id, result: { outcome: "x" } });

    world.router.recycleHarness("claude-code");
    const reconnected = world.connect();
    startSession(world, reconnected, "claude-code", "s-b", 1, {});
    expect(world.harnessCount("claude-code")).toBe(2);
    world.harness("claude-code").emit(frames.requestPermission(7, "s-b"));
    const [after] = reconnected.saw("session/request_permission") as [Frame];
    expect(after.id).not.toEqual(before.id);
  });

  /** TEST_SCENARIO: Taking Curve Bender away recycles the idle Claude Code
   * process (the router env, tier slots included, follows the providers) and
   * the next frame respawns one that serves IBM's session on. A session on a
   * Curve Bender model has nothing that serves it on its next prompt, so it is
   * refused with the no-provider copy, and runs again once it picks another
   * provider's model. */
  it("refuses a session nothing serves after its provider is removed", () => {
    const world = createLeaseWorld({ providers: ["conn-a", "conn-b"] });
    const client = world.connect();
    startSession(world, client, "claude-code", "s-a", 1, {
      model: "ibm/aws/claude-opus-4-8",
    });
    startSession(world, client, "claude-code", "s-b", 2, {
      model: "cb/rits/zai-org/glm-5-3",
    });
    const first = world.harness("claude-code");
    first.replyToSession("session/set_config_option", "s-a", {});
    first.replyToSession("session/set_config_option", "s-b", {});
    world.revoke("conn-b");
    expect(first.killed()).toBe(true);
    expect(client.isOpen()).toBe(false);

    const again = world.connect();
    again.send(frames.prompt(3, "s-b", "still there?"));
    expect(again.reply(3)?.error).toMatchObject({
      message: expect.stringMatching(/no model provider that serves/),
      data: { platform: { reason: NO_MODEL_REASON } },
    });
    again.send(frames.prompt(4, "s-a", "fine"));
    expect(world.harnessCount("claude-code")).toBe(2);
    const respawned = world.harness("claude-code");
    respawned.replyToSession("session/set_config_option", "s-a", {});
    expect(promptTextsOf(respawned)).toEqual(["fine"]);

    again.send({
      jsonrpc: "2.0",
      id: 5,
      method: PIN_MODEL_METHOD,
      params: { sessionId: "s-b", model: "ibm/aws/claude-sonnet-4-6" },
    });
    expect(again.reply(5)?.result).toEqual({
      model: "ibm/aws/claude-sonnet-4-6",
    });
    again.send(frames.prompt(6, "s-b", "back"));
    respawned.replyToSession("session/set_config_option", "s-b", {});
    expect(promptTextsOf(respawned)).toEqual(["fine", "back"]);
    expect(world.router.leases()).toEqual([{ harness: "claude-code" }]);
  });

  /** TEST_SCENARIO: A session written before models were qualified carries a
   * bare model and a provider Connection id; that Connection's alias
   * qualifies the model, which the harness then receives. */
  it("qualifies an old session's bare model by its provider's alias", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    world.metadata.store.set("old", {
      mode: "chat",
      harness: "claude-code",
      provider: "conn-a",
      model: "opus",
    });
    const client = world.connect();
    client.send(frames.loadSession(1, "old"));
    const harness = world.harness("claude-code");
    harness.replyToSession("session/load", "old", {});
    expect(modelFrames(harness, "old")).toEqual(["ibm/opus"]);
    expect(world.metadata.store.get("old")?.meta.model).toBe("ibm/opus");
  });

  /** TEST_SCENARIO: A session from before qualified models names a provider
   * Connection the agent no longer holds; nothing can qualify its model, and
   * no provider serves the session, so its prompt is refused with the copy
   * that says a provider is missing instead of running on whatever provider
   * lists that bare name. */
  it("refuses an old session whose provider Connection was revoked", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    for (const [sessionId, model] of [
      ["old-model", "opus"],
      ["old-default", undefined],
    ] as const)
      world.metadata.store.set(sessionId, {
        mode: "chat",
        harness: "claude-code",
        provider: "conn-gone",
        ...(model && { model }),
      });
    const client = world.connect();
    client.send(frames.prompt(1, "old-model", "hi"));
    expect(client.reply(1)?.error).toMatchObject({
      message: expect.stringMatching(/no model provider that serves/),
      data: { platform: { reason: NO_MODEL_REASON } },
    });
    client.send(frames.prompt(2, "old-default", "hi"));
    expect(client.reply(2)?.error).toMatchObject({
      data: { platform: { reason: NO_MODEL_REASON } },
    });
    expect(world.harnessCount("claude-code")).toBe(0);
  });

  /** TEST_SCENARIO: A session opened before a new agent's runtime has its
   * state, as when a create publishes Ready before the runtime's first
   * applyState, is not refused as no-model: it waits for that state, and once
   * the agent's converted chat default is here it opens on its kind's default
   * model, settings and follow marker, so its first prompt runs. The all-null
   * defaults a hello publishes before the conversion are not that state. An
   * agent whose converted default carries no model for the harness is still
   * refused at once. */
  it("opens a session held for the agent's first state on its default", () => {
    vi.useFakeTimers();
    const chat = {
      harness: "claude-code",
      provider: "conn-a",
      model: "ibm/aws/claude-sonnet-4-6",
      settings: { mode: "acceptEdits" },
    };
    let defaults: SessionDefaultsEventPayload | null = null;
    const world = createLeaseWorld({
      providers: ["conn-a"],
      modelRequired: true,
      sessionDefaults: {
        get: () => defaults,
        revision: () => (defaults === null ? 0 : 1),
        set: (next) => {
          defaults = next;
        },
      },
    });
    const client = world.connect();
    client.send(newSessionOn(1, {}));
    expect(client.reply(1)).toBeUndefined();
    world.router.receiveDefaults({
      chat: null,
      channel: null,
      scheduled: null,
    });
    expect(client.reply(1)).toBeUndefined();
    world.router.receiveDefaults({ chat, channel: null, scheduled: null });
    world.harness("claude-code").replyTo("session/new", { sessionId: "s-1" });
    expect(client.reply(1)?.error).toBeUndefined();
    expect(client.reply(1)?.result).toMatchObject({ sessionId: "s-1" });
    expect(world.metadata.store.get("s-1")?.meta).toMatchObject({
      model: chat.model,
      settings: chat.settings,
      follows: "chat",
    });
    const harness = world.harness("claude-code");
    client.send(frames.prompt(2, "s-1", "hi"));
    harness.replyToSession("session/set_config_option", "s-1", {});
    harness.replyToSession("session/set_mode", "s-1", {});
    expect(promptTextsOf(harness)).toEqual(["hi"]);

    const settled = createLeaseWorld({
      providers: ["conn-a"],
      modelRequired: true,
      sessionDefaults: {
        get: () => ({
          chat: { harness: "claude-code", provider: null, model: null },
          channel: null,
          scheduled: null,
        }),
        revision: () => 1,
        set: () => {},
      },
    });
    const other = settled.connect();
    other.send(newSessionOn(2, {}));
    expect(other.reply(2)?.error).toMatchObject({
      data: { platform: { reason: NO_MODEL_REASON } },
    });
  });

  /** TEST_SCENARIO: A prompt that reaches a model-less session while the
   * runtime still has no state is held rather than refused, and once the
   * agent's converted chat default lands it runs on that kind's model. */
  it("holds a prompt with no model until the agent's defaults land", () => {
    vi.useFakeTimers();
    const chat = {
      harness: "claude-code",
      provider: "conn-a",
      model: "ibm/aws/claude-sonnet-4-6",
    };
    let defaults: SessionDefaultsEventPayload | null = null;
    const world = createLeaseWorld({
      providers: ["conn-a"],
      modelRequired: true,
      sessionDefaults: {
        get: () => defaults,
        revision: () => (defaults === null ? 0 : 1),
        set: (next) => {
          defaults = next;
        },
      },
    });
    world.metadata.store.set("old", { type: "regular" });
    const client = world.connect();
    client.send(frames.prompt(1, "old", "hi"));
    expect(client.reply(1)).toBeUndefined();
    world.router.receiveDefaults({
      chat: null,
      channel: null,
      scheduled: null,
    });
    expect(client.reply(1)).toBeUndefined();
    world.router.receiveDefaults({ chat, channel: null, scheduled: null });
    const harness = world.harness("claude-code");
    harness.replyToSession("session/set_config_option", "old", {});
    expect(promptTextsOf(harness)).toEqual(["hi"]);
    expect(world.metadata.store.get("old")?.meta.model).toBe(chat.model);
  });

  /** TEST_SCENARIO: On a harness that reaches its models through the Model
   * Router, a session with no model never reaches the harness, which would
   * otherwise run a model the user never chose: session/new without one is
   * refused as no-model, and an old session's prompt or edited resend is
   * refused (a prompt sent as a notification is dropped) until a model is
   * pinned on it. */
  it("refuses a turn on a session with no model", () => {
    const world = createLeaseWorld({
      providers: ["conn-a"],
      modelRequired: true,
    });
    world.metadata.store.set("old", { mode: "chat" });
    const client = world.connect();
    client.send(newSessionOn(1, {}));
    expect(client.reply(1)?.error).toMatchObject({
      data: { platform: { reason: NO_MODEL_REASON } },
    });
    client.send(frames.prompt(2, "old", "hi"));
    expect(client.reply(2)?.error).toMatchObject({
      message: expect.stringMatching(/Providers page/),
      data: { platform: { reason: NO_MODEL_REASON } },
    });
    client.send({
      jsonrpc: "2.0",
      method: "session/prompt",
      params: { sessionId: "old", prompt: [{ type: "text", text: "hi" }] },
    });
    client.send({
      jsonrpc: "2.0",
      id: 5,
      method: "platform/rewriteFrom",
      params: { sessionId: "old", messageId: "m-1", prompt: [] },
    });
    expect(client.reply(5)?.error).toMatchObject({
      data: { platform: { reason: NO_MODEL_REASON } },
    });
    expect(world.harnessCount("claude-code")).toBe(0);

    client.send({
      jsonrpc: "2.0",
      id: 3,
      method: PIN_MODEL_METHOD,
      params: { sessionId: "old", model: "ibm/aws/claude-sonnet-4-6" },
    });
    expect(client.reply(3)?.result).toEqual({
      model: "ibm/aws/claude-sonnet-4-6",
    });
    client.send(frames.prompt(4, "old", "now"));
    const harness = world.harness("claude-code");
    harness.replyToSession("session/set_config_option", "old", {});
    expect(promptTextsOf(harness)).toEqual(["now"]);
  });

  /** TEST_SCENARIO: An old session with no model and no follow marker has no
   * pick of its own to keep, so while the agent holds a chat default with a
   * model, its next prompt takes that model instead of being refused, and
   * before a catalog model another provider lists. */
  it("runs an old session with no model on its kind's default", async () => {
    const catalog = catalogFor(
      () => [curveBender("256000")],
      () => ["claude-opus-5-5"],
    );
    await catalog.refresh();
    const chat = {
      harness: "claude-code",
      provider: "conn-a",
      model: "ibm/aws/claude-sonnet-4-6",
    };
    const world = createLeaseWorld({
      providers: ["conn-a", "conn-cb"],
      catalog,
      modelRequired: true,
      sessionDefaults: {
        get: () => ({ chat, channel: null, scheduled: null }),
        revision: () => 1,
        set: () => {},
      },
    });
    world.metadata.store.set("old", { mode: "chat" });
    const client = world.connect();
    client.send(frames.prompt(1, "old", "hi"));
    const harness = world.harness("claude-code");
    harness.replyToSession("session/set_config_option", "old", {});
    expect(promptTextsOf(harness)).toEqual(["hi"]);
    expect(world.metadata.store.get("old")?.meta.model).toBe(chat.model);
  });

  /** TEST_SCENARIO: A Session's own model stays while its provider still lists
   * it for the Session's harness, even when another model would serve: the
   * catalog is consulted only once the Session's own choice cannot. */
  it("keeps a session's own model while its provider lists it", async () => {
    const catalog = catalogFor(
      () => [IBM],
      () => ["aws/claude-sonnet-4-6"],
    );
    await catalog.refresh();
    const chat = {
      harness: "claude-code",
      provider: "conn-ibm",
      model: "ibm/aws/claude-opus-4-8",
    };
    const world = createLeaseWorld({
      providers: ["conn-ibm"],
      catalog,
      modelRequired: true,
      sessionDefaults: {
        get: () => ({ chat, channel: null, scheduled: null }),
        revision: () => 1,
        set: () => {},
      },
    });
    world.metadata.store.set("old", {
      mode: "chat",
      model: "ibm/aws/claude-sonnet-4-6",
    });
    const client = world.connect();
    client.send(frames.prompt(1, "old", "hi"));
    const harness = world.harness("claude-code");
    harness.replyToSession("session/set_config_option", "old", {});
    expect(promptTextsOf(harness)).toEqual(["hi"]);
    expect(world.metadata.store.get("old")?.meta.model).toBe(
      "ibm/aws/claude-sonnet-4-6",
    );
  });

  /** TEST_SCENARIO: An old model-less Session whose kind's default runs on
   * another harness keeps its own harness, so the default is not applied; it
   * runs on a model of the provider the default names, which the catalog
   * prefers over the first provider it happens to list. */
  it("runs on the default's provider when the default sits on another harness", async () => {
    const catalog = catalogFor(
      () => [curveBender("256000"), IBM],
      () => ["aws/claude-opus-4-8", "aws/claude-sonnet-4-6"],
    );
    await catalog.refresh();
    const world = createLeaseWorld({
      providers: ["conn-cb", "conn-ibm"],
      catalog,
      modelRequired: true,
      sessionDefaults: {
        get: () => ({
          chat: {
            harness: "pi",
            provider: "conn-ibm",
            model: "ibm/aws/claude-opus-4-8",
          },
          channel: null,
          scheduled: null,
        }),
        revision: () => 1,
        set: () => {},
      },
    });
    world.metadata.store.set("old", { mode: "chat" });
    const client = world.connect();
    client.send(frames.prompt(1, "old", "hi"));
    const harness = world.harness("claude-code");
    harness.replyToSession("session/set_config_option", "old", {});
    expect(promptTextsOf(harness)).toEqual(["hi"]);
    expect(world.metadata.store.get("old")?.meta).toMatchObject({
      model: "ibm/aws/claude-opus-4-8",
    });
  });

  /** TEST_SCENARIO: A Session whose model's provider was revoked runs on the
   * preferred work model of another granted provider, on its own harness, and
   * keeps that model from then on; it is refused only when nothing lists one. */
  it("runs a revoked session on the preferred work model of another provider", async () => {
    const catalog = catalogFor(
      () => [curveBender("256000")],
      () => ["rits/zai-org/glm-5-3", "claude-opus-5-5"],
    );
    await catalog.refresh();
    const world = createLeaseWorld({
      providers: ["conn-cb"],
      catalog,
      modelRequired: true,
    });
    world.metadata.store.set("old", {
      mode: "chat",
      harness: "claude-code",
      model: "ibm/aws/claude-opus-4-8",
    });
    const client = world.connect();
    client.send(frames.prompt(1, "old", "hi"));
    const harness = world.harness("claude-code");
    harness.replyToSession("session/set_config_option", "old", {});
    expect(promptTextsOf(harness)).toEqual(["hi"]);
    expect(world.metadata.store.get("old")?.meta).toMatchObject({
      harness: "claude-code",
      model: "cb/claude-opus-5-5",
    });
  });

  /** TEST_SCENARIO: A session/new the api-server left without a model, after
   * the agent's defaults settled, runs on a catalog model instead of being
   * refused, and opens on the provider-qualified name a Session stores. */
  it("opens a session the api-server left without a model on a catalog model", async () => {
    const catalog = catalogFor(
      () => [curveBender("256000")],
      () => ["claude-opus-5-5"],
    );
    await catalog.refresh();
    const world = createLeaseWorld({
      providers: ["conn-cb"],
      catalog,
      modelRequired: true,
      modelWaitMs: MODEL_WAIT_MS,
      sessionDefaults: {
        get: () => ({
          chat: { harness: "claude-code", provider: null, model: null },
          channel: null,
          scheduled: null,
        }),
        revision: () => 1,
        set: () => {},
      },
    });
    const client = world.connect();
    client.send(newSessionOn(1, {}));
    const harness = world.harness("claude-code");
    harness.replyTo("session/new", { sessionId: "s-1" });
    expect(client.reply(1)?.result).toMatchObject({ sessionId: "s-1" });
    expect(world.metadata.store.get("s-1")?.meta.model).toBe(
      "cb/claude-opus-5-5",
    );
  });

  /** TEST_SCENARIO: With no provider listing a model yet, a prompt is held
   * rather than refused, and it runs once a listing arrives, as when a
   * CurveBender grant reaches the agent after the frame did. */
  it("holds a prompt until a provider lists a model, then runs it", async () => {
    let models: string[] = [];
    const catalog = catalogFor(
      () => [curveBender("256000")],
      () => models,
    );
    await catalog.refresh();
    const world = createLeaseWorld({
      providers: ["conn-cb"],
      catalog,
      modelRequired: true,
      modelWaitMs: MODEL_WAIT_MS,
      sessionDefaults: {
        get: () => ({
          chat: { harness: "claude-code", provider: null, model: null },
          channel: null,
          scheduled: null,
        }),
        revision: () => 1,
        set: () => {},
      },
    });
    world.metadata.store.set("old", { mode: "chat" });
    const client = world.connect();
    client.send(frames.prompt(1, "old", "hi"));
    expect(client.reply(1)).toBeUndefined();
    expect(world.harnessCount("claude-code")).toBe(0);

    models = ["claude-opus-5-5"];
    await catalog.refresh();
    const harness = world.harness("claude-code");
    harness.replyToSession("session/set_config_option", "old", {});
    expect(promptTextsOf(harness)).toEqual(["hi"]);
    expect(world.metadata.store.get("old")?.meta.model).toBe(
      "cb/claude-opus-5-5",
    );
  });

  /** TEST_SCENARIO: A prompt that no provider can serve after the bounded wait
   * for a model is refused with the copy that names a provider as what is
   * missing, not a model to pick. */
  it("refuses a prompt with no provider once the wait for a model passes", async () => {
    vi.useFakeTimers();
    const catalog = catalogFor(
      () => [curveBender("256000")],
      () => [],
    );
    await catalog.refresh();
    const world = createLeaseWorld({
      providers: ["conn-cb"],
      catalog,
      modelRequired: true,
      modelWaitMs: MODEL_WAIT_MS,
      sessionDefaults: {
        get: () => ({
          chat: { harness: "claude-code", provider: null, model: null },
          channel: null,
          scheduled: null,
        }),
        revision: () => 1,
        set: () => {},
      },
    });
    world.metadata.store.set("old", { mode: "chat" });
    const client = world.connect();
    client.send(frames.prompt(1, "old", "hi"));
    expect(client.reply(1)).toBeUndefined();
    vi.advanceTimersByTime(MODEL_WAIT_MS);
    expect(client.reply(1)?.error).toMatchObject({
      message:
        "This agent has no model provider that serves this session. Connect a model provider on the agent's Providers page.",
      data: { platform: { reason: NO_MODEL_REASON } },
    });
    expect(world.harnessCount("claude-code")).toBe(0);
  });

  /** TEST_SCENARIO: A Session whose qualified model its listed provider no
   * longer names has nothing to run on when the catalog holds nothing else,
   * so its prompt is refused with the copy that names a provider as what is
   * missing, after the bounded wait for a model, instead of running the
   * deleted name. */
  it("refuses a prompt whose model the catalog no longer lists", async () => {
    vi.useFakeTimers();
    const catalog = catalogFor(
      () => [IBM],
      () => [],
    );
    await catalog.refresh();
    const world = createLeaseWorld({
      providers: ["conn-ibm"],
      catalog,
      modelRequired: true,
      modelWaitMs: MODEL_WAIT_MS,
      sessionDefaults: {
        get: () => ({
          chat: { harness: "claude-code", provider: null, model: null },
          channel: null,
          scheduled: null,
        }),
        revision: () => 1,
        set: () => {},
      },
    });
    world.metadata.store.set("old", {
      mode: "chat",
      harness: "claude-code",
      model: "ibm/aws/claude-opus-4-8",
    });
    const client = world.connect();
    client.send(frames.prompt(1, "old", "hi"));
    expect(client.reply(1)).toBeUndefined();
    vi.advanceTimersByTime(MODEL_WAIT_MS);
    expect(client.reply(1)?.error).toMatchObject({
      message:
        "This agent has no model provider that serves this session. Connect a model provider on the agent's Providers page.",
      data: { platform: { reason: NO_MODEL_REASON } },
    });
    expect(world.harnessCount("claude-code")).toBe(0);
  });

  /** TEST_SCENARIO: A session/new that names a model whose provider the agent
   * lost has nothing to open on once its wait for a model passes, so it is
   * refused with the copy that names a provider as what is missing, the same
   * refusal a prompt gets, rather than as a provider removed. */
  it("refuses a session/new whose provider is gone once the wait passes", async () => {
    vi.useFakeTimers();
    const catalog = catalogFor(
      () => [curveBender("256000")],
      () => [],
    );
    await catalog.refresh();
    const world = createLeaseWorld({
      providers: ["conn-cb"],
      catalog,
      modelRequired: true,
      modelWaitMs: MODEL_WAIT_MS,
      sessionDefaults: {
        get: () => ({
          chat: { harness: "claude-code", provider: null, model: null },
          channel: null,
          scheduled: null,
        }),
        revision: () => 1,
        set: () => {},
      },
    });
    const client = world.connect();
    client.send(newSessionOn(1, { model: "ibm/aws/claude-opus-4-8" }));
    expect(client.reply(1)).toBeUndefined();
    vi.advanceTimersByTime(MODEL_WAIT_MS);
    expect(client.reply(1)?.error).toMatchObject({
      message:
        "This agent has no model provider that serves this session. Connect a model provider on the agent's Providers page.",
      data: { platform: { reason: NO_MODEL_REASON } },
    });
    expect(world.harnessCount("claude-code")).toBe(0);
  });

  /** TEST_SCENARIO: Loading a Session's transcript to view it needs no model,
   * so a load or resume of a Session whose provider was revoked reaches the
   * harness at once on whatever model it last had, neither held nor refused;
   * only a prompt has to wait for a model and can be refused. */
  it("resumes a revoked session without waiting for a model", async () => {
    const catalog = catalogFor(
      () => [IBM],
      () => [],
    );
    await catalog.refresh();
    const world = createLeaseWorld({
      providers: ["conn-ibm"],
      catalog,
      modelRequired: true,
      modelWaitMs: MODEL_WAIT_MS,
      sessionDefaults: {
        get: () => ({
          chat: { harness: "claude-code", provider: null, model: null },
          channel: null,
          scheduled: null,
        }),
        revision: () => 1,
        set: () => {},
      },
    });
    world.metadata.store.set("old", {
      mode: "chat",
      harness: "claude-code",
      model: "cb/rits/zai-org/glm-5-3",
    });
    const client = world.connect();
    client.send(frames.loadSession(1, "old"));
    const harness = world.harness("claude-code");
    expect(harness.receivedMethods()).toContain("session/load");
    harness.replyTo("session/load", {});
    harness.replyToSession("session/set_config_option", "old", {});
    expect(client.reply(1)?.error).toBeUndefined();
    client.send({
      jsonrpc: "2.0",
      id: 2,
      method: "session/resume",
      params: { sessionId: "old", cwd: ".", mcpServers: [] },
    });
    expect(client.reply(2)).toBeDefined();
    expect(client.reply(2)?.error).toBeUndefined();
  });

  /** TEST_SCENARIO: A fire resumes its Session before any provider lists a
   * model; the driver asks the runtime for a model and waits, so its prompt is
   * not dropped into a closed connection when a hold would release it, and it
   * runs once the catalog lists one, as when the CurveBender grant lands after
   * the fire did. */
  it("runs a trigger resume once the catalog lists a model", async () => {
    let models: string[] = [];
    const catalog = catalogFor(
      () => [curveBender("256000")],
      () => models,
    );
    await catalog.refresh();
    const world = createLeaseWorld({
      providers: ["conn-cb"],
      catalog,
      modelRequired: true,
      modelWaitMs: MODEL_WAIT_MS,
      sessionDefaults: {
        get: () => ({
          chat: { harness: "claude-code", provider: null, model: null },
          channel: null,
          scheduled: null,
        }),
        revision: () => 1,
        set: () => {},
      },
    });
    world.metadata.store.set("scheduled", {
      type: "schedule_cron",
      harness: "claude-code",
    });
    const driver = createTriggerSessionDriver({
      acpRuntime: world.router,
      modelMissing: (sessionId) => world.router.modelMissing(sessionId),
      modelReady: (sessionId) => world.router.modelReady(sessionId),
      sessionMetadata: world.metadata.store,
    });
    const started = driver.start({
      task: "due",
      resumeSessionId: "scheduled",
      unattended: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const harness = world.harness("claude-code");
    harness.replyTo("session/load", {});
    expect(harness.receivedMethods()).not.toContain("session/prompt");

    models = ["claude-opus-5-5"];
    await catalog.refresh();
    expect((await started).sessionId).toBe("scheduled");
    harness.replyToSession("session/set_config_option", "scheduled", {});
    expect(promptTextsOf(harness)).toEqual(["due"]);
  });

  /** TEST_SCENARIO: A Session whose native provider is revoked mid-turn keeps
   * its transcript on the process it started on: resolving another model for
   * it must not write to its metadata while the turn runs, so the change lands
   * once the turn ends. */
  it("does not move a running session off the process its turn runs on", async () => {
    vi.useFakeTimers();
    const catalog = catalogFor(
      () => [curveBender("256000")],
      () => ["claude-opus-5-5"],
    );
    await catalog.refresh();
    const world = createLeaseWorld({
      providers: ["conn-bedrock", "conn-cb"],
      catalog,
      modelRequired: true,
      modelWaitMs: MODEL_WAIT_MS,
    });
    world.metadata.store.set("s", {
      mode: "chat",
      harness: "claude-code",
      model: "bedrock/opus",
    });
    const client = world.connect();
    client.send(frames.prompt(1, "s", "busy"));
    const native = world.harness("claude-code/native-conn-bedrock");
    native.replyToSession("session/set_config_option", "s", {});
    expect(promptTextsOf(native)).toEqual(["busy"]);

    world.dropProvider("conn-bedrock");
    const ready = world.router.modelReady("s");
    vi.advanceTimersByTime(MODEL_WAIT_MS);
    expect(await ready).toBe(false);
    expect(world.metadata.store.get("s")?.meta.model).toBe("bedrock/opus");

    native.replyToSession("session/prompt", "s", { stopReason: "end_turn" });
    expect(await world.router.modelReady("s")).toBe(true);
    expect(world.metadata.store.get("s")?.meta.model).toBe(
      "cb/claude-opus-5-5",
    );
  });

  /** TEST_SCENARIO: A changed default of a Session's kind is applied to the
   * next turn only, so the default's model and settings must not reach a
   * Session whose turn still runs on a process its pair would no longer name,
   * as when the native provider that process runs on was revoked. */
  it("does not move a running session onto a changed default", () => {
    let revision = 1;
    let chat: NonNullable<SessionDefaultsEventPayload["chat"]> = {
      harness: "claude-code",
      provider: "conn-bedrock",
      model: "bedrock/opus",
    };
    const world = createLeaseWorld({
      providers: ["conn-bedrock", "conn-ibm"],
      modelRequired: true,
      sessionDefaults: {
        get: () => ({ chat, channel: null, scheduled: null }),
        revision: () => revision,
        set: () => {},
      },
    });
    world.metadata.store.set("s", {
      mode: "chat",
      harness: "claude-code",
      model: "bedrock/opus",
      follows: "chat",
    });
    const client = world.connect();
    client.send(frames.prompt(1, "s", "busy"));
    const native = world.harness("claude-code/native-conn-bedrock");
    native.replyToSession("session/set_config_option", "s", {});
    expect(promptTextsOf(native)).toEqual(["busy"]);

    revision = 2;
    chat = {
      harness: "claude-code",
      provider: "conn-ibm",
      model: "ibm/aws/claude-sonnet-4-6",
      settings: { cacheTtl: "2" },
    };
    world.dropProvider("conn-bedrock");
    client.send(frames.prompt(2, "s", "again"));
    expect(world.metadata.store.get("s")?.meta).toMatchObject({
      model: "bedrock/opus",
    });
    expect(world.metadata.store.get("s")?.meta.settings).toBeUndefined();
  });

  /** TEST_SCENARIO: The wait for a model belongs to the frames that started
   * it: a change re-routes them against the same deadline, so a catalog (or an
   * env) that keeps changing cannot keep a prompt waiting past the bound. */
  it("keeps a frame's model wait through later changes", async () => {
    vi.useFakeTimers();
    const catalog = catalogFor(
      () => [curveBender("256000")],
      () => [],
    );
    await catalog.refresh();
    const world = createLeaseWorld({
      providers: ["conn-cb"],
      catalog,
      modelRequired: true,
      modelWaitMs: MODEL_WAIT_MS,
      sessionDefaults: {
        get: () => ({
          chat: { harness: "claude-code", provider: null, model: null },
          channel: null,
          scheduled: null,
        }),
        revision: () => 1,
        set: () => {},
      },
    });
    world.metadata.store.set("old", { mode: "chat" });
    const client = world.connect();
    client.send(frames.prompt(1, "old", "hi"));
    const change = (): void => {
      world.router.applyEnvChange({
        namesChanged: false,
        base: { namesChanged: false },
        providers: [],
        harnesses: [],
      });
    };
    vi.advanceTimersByTime(MODEL_WAIT_MS / 2);
    change();
    expect(client.reply(1)).toBeUndefined();
    vi.advanceTimersByTime(MODEL_WAIT_MS / 2);
    change();
    expect(client.reply(1)?.error).toMatchObject({
      data: { platform: { reason: NO_MODEL_REASON } },
    });
  });

  /** TEST_SCENARIO: A wait for a model belongs to the fire that asked, so a
   * change that names no model yet leaves it pending and the model a later
   * catalog lists satisfies it, rather than the change ending the wait. */
  it("keeps a model wait pending until a later listing serves the session", async () => {
    vi.useFakeTimers();
    let models: string[] = [];
    const catalog = catalogFor(
      () => [curveBender("256000")],
      () => models,
    );
    await catalog.refresh();
    const world = createLeaseWorld({
      providers: ["conn-cb"],
      catalog,
      modelRequired: true,
      modelWaitMs: MODEL_WAIT_MS,
      sessionDefaults: {
        get: () => ({
          chat: { harness: "claude-code", provider: null, model: null },
          channel: null,
          scheduled: null,
        }),
        revision: () => 1,
        set: () => {},
      },
    });
    world.metadata.store.set("scheduled", {
      type: "schedule_cron",
      harness: "claude-code",
    });
    let settled: boolean | null = null;
    const ready = world.router.modelReady("scheduled");
    void ready.then((value) => {
      settled = value;
    });
    vi.advanceTimersByTime(MODEL_WAIT_MS / 2);
    world.router.applyEnvChange({
      namesChanged: false,
      base: { namesChanged: false },
      providers: [],
      harnesses: [],
    });
    await Promise.resolve();
    expect(settled).toBeNull();

    models = ["claude-opus-5-5"];
    await catalog.refresh();
    expect(await ready).toBe(true);
    expect(world.metadata.store.get("scheduled")?.meta.model).toBe(
      "cb/claude-opus-5-5",
    );
  });

  /** TEST_SCENARIO: A wait for a model that no change serves still ends at its
   * own deadline after a change re-routed it, so the fire is refused instead
   * of waiting forever. */
  it("ends a model wait at its own deadline after a change", async () => {
    vi.useFakeTimers();
    const catalog = catalogFor(
      () => [curveBender("256000")],
      () => [],
    );
    await catalog.refresh();
    const world = createLeaseWorld({
      providers: ["conn-cb"],
      catalog,
      modelRequired: true,
      modelWaitMs: MODEL_WAIT_MS,
      sessionDefaults: {
        get: () => ({
          chat: { harness: "claude-code", provider: null, model: null },
          channel: null,
          scheduled: null,
        }),
        revision: () => 1,
        set: () => {},
      },
    });
    world.metadata.store.set("scheduled", {
      type: "schedule_cron",
      harness: "claude-code",
    });
    const ready = world.router.modelReady("scheduled");
    vi.advanceTimersByTime(MODEL_WAIT_MS / 2);
    world.router.applyEnvChange({
      namesChanged: false,
      base: { namesChanged: false },
      providers: [],
      harnesses: [],
    });
    await Promise.resolve();
    vi.advanceTimersByTime(MODEL_WAIT_MS / 2);
    expect(await ready).toBe(false);
  });

  /** TEST_SCENARIO: A Session pinned to its own choice and away from the
   * defaults it still follows (`followsAfter`) does not take that kind's
   * default while the defaults it left behind are the current ones; the
   * catalog answers instead. */
  it("skips a stale kind default for a session pinned away from it", async () => {
    const catalog = catalogFor(
      () => [curveBender("256000")],
      () => ["claude-opus-5-5"],
    );
    await catalog.refresh();
    const world = createLeaseWorld({
      providers: ["conn-ibm", "conn-cb"],
      catalog,
      modelRequired: true,
      sessionDefaults: {
        get: () => ({
          chat: {
            harness: "claude-code",
            provider: "conn-ibm",
            model: "ibm/aws/claude-sonnet-4-6",
          },
          channel: null,
          scheduled: null,
        }),
        revision: () => 5,
        set: () => {},
      },
    });
    world.metadata.store.set("old", {
      mode: "chat",
      follows: "chat",
      followsAfter: 5,
    });
    const client = world.connect();
    client.send(frames.prompt(1, "old", "hi"));
    const harness = world.harness("claude-code");
    harness.replyToSession("session/set_config_option", "old", {});
    expect(promptTextsOf(harness)).toEqual(["hi"]);
    expect(world.metadata.store.get("old")?.meta.model).toBe(
      "cb/claude-opus-5-5",
    );
  });

  /** TEST_SCENARIO: A model a person pins by hand is their choice, not a
   * preference the runtime may replace, so a pin naming a provider the agent
   * lost is still refused with the provider named. */
  it("still refuses a hand pin to a provider the agent lost", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    world.metadata.store.set("s", { mode: "chat", model: "ibm/opus" });
    const client = world.connect();
    client.send({
      jsonrpc: "2.0",
      id: 1,
      method: PIN_MODEL_METHOD,
      params: { sessionId: "s", model: "cb/rits/zai-org/glm-5-3" },
    });
    expect(client.reply(1)?.error).toMatchObject({
      data: {
        platform: { reason: PROVIDER_REMOVED_REASON, provider: "cb" },
      },
    });
  });

  /** TEST_SCENARIO: A session whose harness this agent no longer carries is
   * refused with a clear error, not run on another harness. */
  it("refuses a session on a harness the agent does not carry", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    world.metadata.store.set("gone", { mode: "chat", harness: "gemini" });
    const client = world.connect();
    client.send(frames.prompt(1, "gone", "hello"));
    expect(client.reply(1)?.error).toMatchObject({ code: -32602 });
    expect(world.harnessCount("claude-code")).toBe(0);
  });

  /** TEST_SCENARIO: A rotated credential restarts every process (the router's
   * env follows the provider layers) and closes the connections that used
   * one; a connection that used only control calls stays open. */
  it("closes only the clients that used a restarted process", () => {
    const world = createLeaseWorld({ providers: ["conn-a", "conn-b"] });
    const onA = world.connect();
    const idle = world.connect();
    startSession(world, onA, "claude-code", "s-a", 1, {});
    idle.send(frames.initialize(1));
    world.router.applyEnvChange({
      namesChanged: true,
      base: null,
      providers: [{ id: "conn-a", namesChanged: true }],
      harnesses: [],
    });
    world.harness("claude-code").exit();
    expect(onA.isOpen()).toBe(false);
    expect(idle.isOpen()).toBe(true);
  });
  /** TEST_SCENARIO: A harness dies, as from an
   * out-of-memory kill, while the runtime itself keeps running. The next
   * session starts a new harness process instead of hanging on the dead one,
   * and so does a client that connected before that session asked. */
  it("respawns a dead harness's process for the next session, closing only its old clients", async () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const before = world.connect();
    startSession(world, before, "claude-code", "s-a", 1, {});

    world.harness("claude-code").exit();
    await Promise.resolve();
    expect(before.isOpen()).toBe(false);

    const early = world.connect();
    const late = world.connect();
    startSession(world, late, "claude-code", "s-b", 2, {});
    expect(world.harnessCount("claude-code")).toBe(2);
    expect(late.reply(2)).toMatchObject({ result: { sessionId: "s-b" } });
    late.send(frames.prompt(3, "s-b", "after the crash"));
    expect(promptTextsOf(world.harness("claude-code"))).toEqual([
      "after the crash",
    ]);

    early.send(frames.prompt(4, "s-a", "on the old session"));
    expect(early.isOpen()).toBe(true);
    expect(world.harnessCount("claude-code")).toBe(2);
  });

  /** TEST_SCENARIO: A process goes away once it has held no session for the
   * idle time, the default harness's included, and the connection that used
   * it stays open; the next session respawns it. */
  it("shuts down every lease that held no session for the idle time", () => {
    vi.useFakeTimers();
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const client = world.connect();
    startSession(world, client, "claude-code", "s", 1, {});
    client.send(frames.prompt(2, "s", "work"));
    const first = world.harness("claude-code");
    vi.advanceTimersByTime(LEASE_IDLE_MS + IDLE_CHECK_MS);
    expect(first.killed()).toBe(false);

    first.replyTo("session/prompt", { stopReason: "end_turn" });
    client.disconnect();
    vi.advanceTimersByTime(IDLE_REAP_DELAY_MS + IDLE_CHECK_MS);
    expect(first.killed()).toBe(false);
    vi.advanceTimersByTime(LEASE_IDLE_MS + IDLE_CHECK_MS);
    expect(first.killed()).toBe(true);
    expect(world.router.leases()).toEqual([]);

    const other = world.connect();
    startSession(world, other, "claude-code", "s2", 3, {});
    expect(world.harnessCount("claude-code")).toBe(2);
    expect(other.isOpen()).toBe(true);
  });

  /** TEST_SCENARIO: A crashed process is dropped and respawned by the next
   * frame naming a session on its harness. */
  it("respawns a crashed harness on the next session frame", async () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const client = world.connect();
    startSession(world, client, "claude-code", "s", 1, {});
    world.harness("claude-code").exit();
    await Promise.resolve();
    await Promise.resolve();
    expect(world.router.leases()).toEqual([]);
    const again = world.connect();
    again.send(frames.loadSession(1, "s"));
    expect(world.harnessCount("claude-code")).toBe(2);
  });

  /** TEST_SCENARIO: Background work in a session keeps its process alive
   * after its client leaves and past the idle time. */
  it("keeps a lease busy while one of its sessions holds background work", () => {
    vi.useFakeTimers();
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const client = world.connect();
    startSession(world, client, "claude-code", "s", 1, {});
    world.backgroundWork.report("s", [{ id: "build" }]);
    client.disconnect();
    vi.advanceTimersByTime(IDLE_REAP_DELAY_MS + LEASE_IDLE_MS + IDLE_CHECK_MS);
    expect(world.harness("claude-code").killed()).toBe(false);
  });

  /** TEST_SCENARIO: A kept Detached Process runs outside every harness, so
   * the agent stays awake for it even before any lease is open. */
  it("stays busy for kept Detached Processes with no lease open", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    world.keepProcesses(2);
    expect(world.router.leases()).toEqual([]);
    expect(world.router.status()).toEqual({
      idle: false,
      backgroundWork: [],
      keptProcesses: 2,
      openLinks: 0,
    });
    world.keepProcesses(0);
    expect(world.router.status()).toEqual({
      idle: true,
      backgroundWork: [],
      keptProcesses: 0,
      openLinks: 0,
    });
  });

  /** TEST_SCENARIO: An open Environment Link keeps the agent and its
   * Environment awake, on both ends and whatever the keep decisions say, so
   * neither sleeps during a long image import. */
  it("stays busy while an Environment Link is open", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    world.openLinks(1);
    expect(world.router.status()).toMatchObject({ idle: false, openLinks: 1 });
    world.openLinks(0);
    expect(world.router.status().idle).toBe(true);
  });

  /** TEST_SCENARIO: A restart of the harness leaves a Detached Process
   * running, so a kept one does not hold an env change back. */
  it("recycles for an env change while a kept Detached Process runs", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const client = world.connect();
    startSession(world, client, "claude-code", "s", 1, {});
    world.keepProcesses(1);
    world.router.refreshEnv({ force: false });
    expect(world.harness("claude-code").killed()).toBe(true);
  });

  /** TEST_SCENARIO: Picking another provider's model is accepted while the
   * session's turn runs: it is recorded at once, reaches the harness as the
   * session's own set_config_option once the turn ends, and the next prompt
   * waits for the harness to take it. No process is started or stopped. */
  it("changes a session's model mid-turn for its next turn", () => {
    const world = createLeaseWorld({ providers: ["conn-a", "conn-b"] });
    const client = world.connect();
    startSession(world, client, "claude-code", "s", 1, {
      model: "claude/ibm/aws/claude-sonnet-4-6",
    });
    const harness = world.harness("claude-code");
    harness.replyTo("session/set_config_option", {});
    client.send(frames.prompt(2, "s", "busy"));
    client.send({
      jsonrpc: "2.0",
      id: 3,
      method: PIN_MODEL_METHOD,
      params: { sessionId: "s", model: "cb/rits/zai-org/glm-5-3" },
    });
    expect(client.reply(3)?.result).toEqual({
      model: "cb/rits/zai-org/glm-5-3",
    });
    expect(world.metadata.store.get("s")?.meta.model).toBe(
      "cb/rits/zai-org/glm-5-3",
    );
    expect(modelFrames(harness, "s")).toEqual(["ibm/aws/claude-sonnet-4-6"]);
    client.send(frames.prompt(4, "s", "next"));
    harness.replyToSession("session/prompt", "s", { stopReason: "end_turn" });
    expect(modelFrames(harness, "s")).toEqual([
      "ibm/aws/claude-sonnet-4-6",
      "cb/rits/zai-org/glm-5-3",
    ]);
    expect(promptTextsOf(harness)).toEqual(["busy"]);
    harness.replyTo("session/set_config_option", {});
    expect(promptTextsOf(harness)).toEqual(["busy", "next"]);
    expect(world.harnessCount("claude-code")).toBe(1);
  });

  /** TEST_SCENARIO: The harness refuses the session's model twice (Claude
   * Code could not confirm it with the API), so the session's queued prompt
   * is answered with the harness's own reason rather than run on whatever
   * the harness would substitute; the next prompt, with the model unchanged,
   * asks again and is refused again instead of running on the default. */
  it("refuses the prompt when the harness will not take the session's model", () => {
    vi.useFakeTimers();
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const client = world.connect();
    startSession(world, client, "claude-code", "s", 1, {
      model: "ibm/unknown-model",
    });
    const harness = world.harness("claude-code");
    const refuse = () =>
      harness.refuseTo("session/set_config_option", {
        code: -32603,
        message: "Internal error",
        data: { details: 'Couldn\'t confirm model "ibm/unknown-model"' },
      });
    refuse();
    client.send(frames.prompt(2, "s", "go"));
    vi.advanceTimersByTime(2_500);
    expect(modelFrames(harness, "s")).toHaveLength(2);
    refuse();
    expect(client.reply(2)?.error).toMatchObject({
      message: expect.stringContaining(
        "refused the session's model: Couldn't confirm model \"ibm/unknown-model\"",
      ),
    });
    expect(promptTextsOf(harness)).toEqual([]);

    client.send(frames.prompt(3, "s", "again"));
    expect(modelFrames(harness, "s")).toHaveLength(3);
    refuse();
    vi.advanceTimersByTime(2_500);
    refuse();
    expect(client.reply(3)?.error).toMatchObject({
      message: expect.stringContaining("refused the session's model"),
    });
    expect(promptTextsOf(harness)).toEqual([]);
  });

  /** TEST_SCENARIO: A mode picked during a turn belongs to the session's next
   * turn: it reaches the harness only once the running turn ends, and the
   * prompt sent after it waits for the harness to take the mode first. */
  it("applies a session setting to that session's next turn only", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const client = world.connect();
    startSession(world, client, "claude-code", "s", 1, {});
    startSession(world, client, "claude-code", "other", 2, {});
    const harness = world.harness("claude-code");
    client.send(frames.prompt(3, "s", "first"));
    client.send({
      jsonrpc: "2.0",
      id: 4,
      method: CONFIGURE_SESSION_METHOD,
      params: { sessionId: "s", settings: { mode: "plan" } },
    });
    expect(client.reply(4)?.result).toEqual({ settings: { mode: "plan" } });
    client.send(frames.prompt(5, "s", "second"));
    expect(harness.received("session/set_mode")).toEqual([]);

    harness.replyToSession("session/prompt", "s", { stopReason: "end_turn" });
    expect(harness.received("session/set_mode")).toEqual([
      expect.objectContaining({ params: { sessionId: "s", modeId: "plan" } }),
    ]);
    expect(promptTextsOf(harness)).toEqual(["first"]);
    harness.replyTo("session/set_mode", {});
    expect(promptTextsOf(harness)).toEqual(["first", "second"]);
    expect(world.harnessCount("claude-code")).toBe(1);
    expect(world.metadata.store.get("other")?.meta.settings).toBeUndefined();
  });

  /** TEST_SCENARIO: A mode picked while the session is idle reaches the
   * harness before the session's next prompt. */
  it("applies a setting picked between turns before the next prompt", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const client = world.connect();
    startSession(world, client, "claude-code", "s", 1, {});
    const harness = world.harness("claude-code");
    client.send({
      jsonrpc: "2.0",
      id: 2,
      method: CONFIGURE_SESSION_METHOD,
      params: { sessionId: "s", settings: { mode: "plan" } },
    });
    expect(client.reply(2)?.result).toEqual({ settings: { mode: "plan" } });
    expect(harness.received("session/set_mode")).toEqual([
      expect.objectContaining({ params: { sessionId: "s", modeId: "plan" } }),
    ]);
    client.send(frames.prompt(3, "s", "next"));
    expect(promptTextsOf(harness)).toEqual([]);
    harness.replyTo("session/set_mode", {});
    expect(promptTextsOf(harness)).toEqual(["next"]);
  });

  /** TEST_SCENARIO: A change that names no value is refused, and the saved
   * value stays. */
  /** TEST_SCENARIO: The user puts a setting back to "Same as session" (the
   * UI sends an empty value) or a client sends null: the setting is cleared
   * and the others stay, rather than the change being refused. */
  it("clears a session setting given an empty or null value", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const client = world.connect();
    startSession(world, client, "claude-code", "s", 1, {});
    const configure = (id: number, settings: Record<string, unknown>) =>
      client.send({
        jsonrpc: "2.0",
        id,
        method: CONFIGURE_SESSION_METHOD,
        params: { sessionId: "s", settings },
      });
    configure(2, { mode: "plan", cacheTtl: "1h" });
    configure(3, { cacheTtl: "" });
    expect(client.reply(3)?.result).toEqual({ settings: { mode: "plan" } });
    configure(4, { mode: null });
    expect(client.reply(4)?.result).toEqual({ settings: {} });
    expect(world.metadata.store.get("s")?.meta.settings ?? {}).toEqual({});
  });

  /** TEST_SCENARIO: A new session arrives with a setting left at "Same as
   * session" (an empty value) beside a real one: the empty one is dropped
   * and the session keeps its harness, model and the other setting. A
   * setting of the wrong shape refuses the session instead of silently
   * losing every choice it carried. */
  it("drops an empty setting on session/new and refuses a malformed one", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const client = world.connect();
    client.send({
      jsonrpc: "2.0",
      id: 1,
      method: "session/new",
      params: {
        cwd: ".",
        _meta: {
          platform: {
            harness: "claude-code",
            model: "ibm/aws/claude-opus-4-8",
            settings: { mode: "plan", cacheTtl: "" },
          },
        },
      },
    });
    const harness = world.harness("claude-code");
    harness.replyTo("session/new", { sessionId: "s" });
    expect(world.metadata.store.get("s")?.meta).toMatchObject({
      harness: "claude-code",
      model: "ibm/aws/claude-opus-4-8",
      settings: { mode: "plan" },
    });
    client.send({
      jsonrpc: "2.0",
      id: 2,
      method: "session/new",
      params: {
        cwd: ".",
        _meta: { platform: { settings: { mode: 5 } } },
      },
    });
    expect(client.reply(2)?.error).toMatchObject({ code: -32602 });
  });

  /** TEST_SCENARIO: A harness can switch a session's mode on its own; the
   * session's saved mode follows the harness, and picking plan again reaches
   * the harness. */
  it("follows a mode the harness switched to on its own", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const client = world.connect();
    startSession(world, client, "claude-code", "s", 1, {});
    const harness = world.harness("claude-code");
    const report = (mode: string) =>
      harness.emit({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "s",
          update: { sessionUpdate: "current_mode_update", currentModeId: mode },
        },
      });
    report("acceptEdits");
    expect(world.metadata.store.get("s")?.meta.settings).toEqual({
      mode: "acceptEdits",
    });
    client.send({
      jsonrpc: "2.0",
      id: 2,
      method: CONFIGURE_SESSION_METHOD,
      params: { sessionId: "s", settings: { mode: "plan" } },
    });
    harness.replyTo("session/set_mode", {});
    report("auto");
    expect(world.metadata.store.get("s")?.meta.settings).toEqual({
      mode: "auto",
    });
    client.send({
      jsonrpc: "2.0",
      id: 3,
      method: CONFIGURE_SESSION_METHOD,
      params: { sessionId: "s", settings: { mode: "plan" } },
    });
    expect(harness.received("session/set_mode")).toHaveLength(2);
  });

  /** TEST_SCENARIO: After the agent restarts, a client that loads a saved
   * session gets its saved model and mode on the new harness process before
   * it can prompt, so both survive the restart. The mode follows the model's
   * own answer, since the harness reads a mode against the model it holds. */
  it("re-applies the saved model and settings when a client loads the session", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    world.metadata.store.set("saved", {
      mode: "chat",
      harness: "claude-code",
      model: "ibm/aws/claude-opus-4-8",
      settings: { mode: "plan" },
    });
    const client = world.connect();
    client.send(frames.loadSession(1, "saved"));
    const harness = world.harness("claude-code");
    harness.replyToSession("session/load", "saved", {});
    expect(modelFrames(harness, "saved")).toEqual(["ibm/aws/claude-opus-4-8"]);
    expect(harness.received("session/set_mode")).toEqual([]);
    harness.replyToSession("session/set_config_option", "saved", {});
    expect(harness.received("session/set_mode")).toEqual([
      expect.objectContaining({
        params: { sessionId: "saved", modeId: "plan" },
      }),
    ]);
  });

  /** TEST_SCENARIO: A setting the harness reads only at start moves the
   * session to a process started with it, so the process other sessions run
   * on is neither restarted nor changed. A session in the middle of a turn
   * cannot move, so the change is refused until the turn ends. */
  it("runs a session with a start-time setting in a process of its own", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const client = world.connect();
    startSession(world, client, "claude-code", "s", 1, {});
    startSession(world, client, "claude-code", "other", 2, {});
    const shared = world.harness("claude-code");
    client.send(frames.prompt(3, "s", "busy"));
    const configure = (id: number) =>
      client.send({
        jsonrpc: "2.0",
        id,
        method: CONFIGURE_SESSION_METHOD,
        params: { sessionId: "s", settings: { cacheTtl: "1h" } },
      });
    configure(4);
    expect(client.reply(4)?.error).toMatchObject({ code: -32000 });

    shared.replyToSession("session/prompt", "s", { stopReason: "end_turn" });
    configure(5);
    expect(client.reply(5)?.result).toEqual({ settings: { cacheTtl: "1h" } });
    client.send(frames.prompt(6, "s", "cached"));
    const own = world.harness("claude-code/cache-1h");
    const load = own
      .receivedMethods()
      .find((m) => ["session/load", "session/resume"].includes(m));
    own.replyTo(load!, {});
    expect(promptTextsOf(own)).toEqual(["cached"]);
    expect(shared.killed()).toBe(false);
    client.send(frames.prompt(7, "other", "unchanged"));
    expect(promptTextsOf(shared)).toEqual(["busy", "unchanged"]);
  });

  /** TEST_SCENARIO: An agent holds IBM through the router and Bedrock,
   * which Claude Code runs natively. A session on IBM picks Bedrock's
   * Sonnet tier: mid-turn that is refused, since the session
   * would have to leave its process; between turns it moves to a Claude
   * process of its own for that Connection, loads there, and gets
   * Claude Code's own model name. Another session keeps the routed process. */
  it("moves a session that picks a natively run model to a process of its own", () => {
    const world = createLeaseWorld({ providers: ["conn-a", "conn-bedrock"] });
    const client = world.connect();
    startSession(world, client, "claude-code", "s", 1, {
      model: "ibm/aws/claude-sonnet-4-6",
    });
    startSession(world, client, "claude-code", "other", 2, {});
    const routed = world.harness("claude-code");
    routed.replyTo("session/set_config_option", {});
    client.send(frames.prompt(3, "s", "busy"));
    const pin = (id: number) =>
      client.send({
        jsonrpc: "2.0",
        id,
        method: PIN_MODEL_METHOD,
        params: { sessionId: "s", model: "bedrock/sonnet" },
      });
    pin(4);
    expect(client.reply(4)?.error).toMatchObject({ code: -32000 });
    expect(world.metadata.store.get("s")?.meta.model).toBe(
      "ibm/aws/claude-sonnet-4-6",
    );

    routed.replyToSession("session/prompt", "s", { stopReason: "end_turn" });
    pin(5);
    expect(client.reply(5)?.result).toEqual({ model: "bedrock/sonnet" });
    client.send(frames.prompt(6, "s", "native"));
    const native = world.harness("claude-code/native-conn-bedrock");
    const load = native
      .receivedMethods()
      .find((m) => ["session/load", "session/resume"].includes(m));
    native.replyTo(load!, {});
    expect(modelFrames(native, "s")).toEqual(["bedrock/sonnet"]);
    native.replyTo("session/set_config_option", {});
    expect(promptTextsOf(native)).toEqual(["native"]);
    expect(routed.killed()).toBe(false);
    client.send(frames.prompt(7, "other", "routed"));
    expect(promptTextsOf(routed)).toEqual(["busy", "routed"]);
  });

  /** TEST_SCENARIO: Claude Code asks the server to check auto-mode actions,
   * and only a Claude model answers, so a session on a model that is not
   * Claude needs a process started with that check off. A session on IBM's
   * Claude that picks IBM's GPT moves, between turns, to a process of its
   * own started with that env; the Claude session beside it stays in the
   * first process, which keeps the check. */
  it("moves a session that picks a model that is not Claude to a process of its own", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const client = world.connect();
    startSession(world, client, "claude-code", "s", 1, {
      model: "ibm/aws/claude-sonnet-4-6",
    });
    startSession(world, client, "claude-code", "other", 2, {});
    const claude = world.harness("claude-code");
    claude.replyTo("session/set_config_option", {});
    client.send(frames.prompt(3, "s", "busy"));
    const pin = (id: number) =>
      client.send({
        jsonrpc: "2.0",
        id,
        method: PIN_MODEL_METHOD,
        params: { sessionId: "s", model: "ibm/azure/gpt-5.5" },
      });
    pin(4);
    expect(client.reply(4)?.error).toMatchObject({ code: -32000 });

    claude.replyToSession("session/prompt", "s", { stopReason: "end_turn" });
    pin(5);
    expect(client.reply(5)?.result).toEqual({ model: "ibm/azure/gpt-5.5" });
    client.send(frames.prompt(6, "s", "gpt"));
    const own = world.harness("claude-code/env-CLAUDE_CODE_AUTO_MODE_SERVER");
    const load = own
      .receivedMethods()
      .find((m) => ["session/load", "session/resume"].includes(m));
    own.replyTo(load!, {});
    expect(modelFrames(own, "s")).toEqual(["ibm/azure/gpt-5.5"]);
    own.replyTo("session/set_config_option", {});
    expect(promptTextsOf(own)).toEqual(["gpt"]);
    expect(world.router.leases()).toContainEqual({
      harness: "claude-code",
      env: { CLAUDE_CODE_AUTO_MODE_SERVER: "0" },
    });
    expect(claude.killed()).toBe(false);
    client.send(frames.prompt(7, "other", "claude"));
    expect(promptTextsOf(claude)).toEqual(["busy", "claude"]);
  });

  /** TEST_SCENARIO: A Claude session whose subagents run on a model that is
   * not Claude sends their calls without the server check too, so the
   * subagent model alone moves the session to the process that does not ask
   * for it. */
  it("moves a Claude session whose subagent model is not Claude to that process", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const client = world.connect();
    client.send({
      jsonrpc: "2.0",
      id: 1,
      method: "session/new",
      params: {
        cwd: ".",
        _meta: {
          platform: {
            model: "ibm/aws/claude-opus-5-5",
            settings: { subagentModel: "ibm/azure/gpt-5.5" },
          },
        },
      },
    });
    world
      .harness(
        "claude-code/subagent-ibm/azure/gpt-5.5/env-CLAUDE_CODE_AUTO_MODE_SERVER",
      )
      .replyTo("session/new", { sessionId: "s" });
    expect(client.reply(1)?.result).toMatchObject({ sessionId: "s" });
    expect(world.harnessCount("claude-code")).toBe(0);
    expect(world.router.leases()).toEqual([
      {
        harness: "claude-code",
        settings: { subagentModel: "ibm/azure/gpt-5.5" },
        env: { CLAUDE_CODE_AUTO_MODE_SERVER: "0" },
      },
    ]);
  });

  /** TEST_SCENARIO: A setting the session's harness does not offer is refused
   * when the session is created and when it is changed. */
  it("refuses a setting the harness cannot apply to one session", () => {
    const world = createLeaseWorld({ providers: ["conn-a"] });
    const client = world.connect();
    client.send(newSessionOn(1, {}));
    client.send({
      jsonrpc: "2.0",
      id: 2,
      method: "session/new",
      params: {
        cwd: ".",
        _meta: { platform: { settings: { approvals: "ask" } } },
      },
    });
    expect(client.reply(2)?.error).toMatchObject({ code: -32602 });
    world.harness("claude-code").replyTo("session/new", { sessionId: "s" });
    client.send({
      jsonrpc: "2.0",
      id: 3,
      method: CONFIGURE_SESSION_METHOD,
      params: { sessionId: "s", settings: { approvals: "ask" } },
    });
    expect(client.reply(3)?.error).toMatchObject({ code: -32602 });
  });
});
