// TEST_OVERVIEW: Interactive agent creation enables a ChatGPT subscription without an API credential, then grants the resulting Connection to the agent.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionView } from "api-server-api";
import { buildCreateInteractiveCommand } from "../modules/agent/commands/create-interactive.js";
import type { TrpcClient } from "../modules/shared/trpc/trpc-client.js";

const prompts = vi.hoisted(() => ({
  providerType: "chatgpt",
  confirm: vi.fn(),
  secret: vi.fn(),
  text: vi.fn(),
  outro: vi.fn(),
}));
vi.mock("@clack/prompts", () => ({
  cancel: vi.fn(),
  confirm: prompts.confirm,
  intro: vi.fn(),
  isCancel: () => false,
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  note: vi.fn(),
  outro: prompts.outro,
  select: async ({ message }: { message: string }) =>
    (
      ({
        Template: "default",
        "Provider type": prompts.providerType,
        "Model provider": "__new__",
      }) as Record<string, string>
    )[message],
  spinner: () => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() }),
  text: prompts.text,
}));
vi.mock("../modules/shared/prompt-secret.js", () => ({
  promptSecret: prompts.secret,
}));

const subscription: ConnectionView = {
  id: "conn-subscription",
  ownerId: "user-1",
  templateId: "openai-chatgpt",
  category: "app",
  name: "subscription",
  status: "active",
  authKind: "none",
  contributions: [],
  hosts: [],
};
const agent = {
  id: "agent-created",
  name: "subscription-agent",
  templateId: "default",
  image: "default:test",
  state: "running" as const,
  channels: [],
};
const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
beforeEach(() => {
  vi.clearAllMocks();
  prompts.providerType = "chatgpt";
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: true,
  });
  prompts.confirm.mockResolvedValue(false);
  prompts.secret.mockImplementation(() => {
    throw new Error("subscription must not request a secret");
  });
  prompts.text.mockImplementation(async ({ message }: { message: string }) =>
    message === "Agent name" ? agent.name : "chatgpt-team",
  );
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`exit ${code}`);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  if (tty) Object.defineProperty(process.stdin, "isTTY", tty);
  else Reflect.deleteProperty(process.stdin, "isTTY");
});

function setup(existing: ConnectionView[] = []) {
  const createConnection = vi.fn().mockResolvedValue(subscription);
  const grant = vi.fn().mockResolvedValue(undefined);
  const updateConnection = vi.fn();
  const trpc = {
    connections: {
      list: { query: async () => existing },
      listTemplates: { query: async () => [] },
      create: { mutate: createConnection },
      update: { mutate: updateConnection },
      setAgentConnections: { mutate: grant },
    },
    agents: { create: { mutate: async () => agent } },
  } as unknown as TrpcClient;
  const command = buildCreateInteractiveCommand({
    compatService: {
      check: async () => ({
        ok: true,
        value: {
          kind: "ok",
          localCli: "1.0.0",
          serverVersion: "1.0.0",
          serverMinClient: undefined,
          serverRecommendedClient: undefined,
        },
      }),
    },
    configService: {
      getResolved: async () => ({
        ok: true,
        value: { server: "http://localhost:4444" },
      }),
      set: vi.fn(),
    },
    createTemplateService: () => ({
      list: async () => ({
        ok: true,
        value: [{ id: "default", name: "Default", image: agent.image }],
      }),
    }),
    createTrpcClient: () => trpc,
    createAgentService: () => ({
      list: vi.fn(),
      get: async () => ({ ok: true, value: agent }),
      deleteAgent: vi.fn(),
      restart: vi.fn(),
      setDisabled: vi.fn(),
      updateIdentity: vi.fn(),
      unlockedCharacters: vi.fn(),
      customAvatarsEnabled: vi.fn(),
      runtimeFleet: vi.fn(),
      kept: vi.fn(),
    }),
  });
  const run = () => command.parseAsync([], { from: "user" });
  return { run, createConnection, updateConnection, grant };
}

describe("interactive ChatGPT subscription setup", () => {
  // TEST_SCENARIO: Adding subscription setup leaves the separate OpenAI API-key path credentialed and routed through its original Connection.
  it("keeps OpenAI API-key setup separate", async () => {
    prompts.providerType = "openai";
    prompts.secret.mockResolvedValue("fixture-api-key");
    const { run, createConnection, grant } = setup();
    createConnection.mockResolvedValue({
      ...subscription,
      id: "conn-api",
      templateId: "openai",
      authKind: "header",
    });
    await expect(run()).rejects.toThrow("exit 0");
    expect(createConnection).toHaveBeenCalledWith({
      templateId: "openai",
      name: "openai",
      authKind: "header",
      value: "fixture-api-key",
    });
    expect(grant).toHaveBeenCalledWith({
      agentId: agent.id,
      connectionIds: ["conn-api"],
    });
    expect(prompts.outro.mock.calls[0]?.[0]).not.toContain(
      "codex-chatgpt login",
    );
  });

  // TEST_SCENARIO: A new subscription creates a secret-free Connection and grants it before the completed agent is returned.
  it("creates and grants a subscription without asking for an API key", async () => {
    const { run, createConnection, grant } = setup();
    await expect(run()).rejects.toThrow("exit 0");
    expect(prompts.secret).not.toHaveBeenCalled();
    expect(createConnection).toHaveBeenCalledWith({
      templateId: "openai-chatgpt",
      name: "openai-chatgpt",
      authKind: "none",
    });
    expect(grant).toHaveBeenCalledWith({
      agentId: agent.id,
      connectionIds: [subscription.id],
    });
    expect(prompts.outro.mock.calls[0]?.[0]).toContain(
      "codex-chatgpt login --device-auth over SSH",
    );
  });

  // TEST_SCENARIO: Choosing the subscription type again reuses its Connection without offering a credential replacement.
  it("reuses an enabled subscription without replacing credentials", async () => {
    const { run, createConnection, updateConnection, grant } = setup([
      subscription,
    ]);
    await expect(run()).rejects.toThrow("exit 0");
    expect(prompts.secret).not.toHaveBeenCalled();
    expect(
      prompts.confirm.mock.calls.map(([input]) => input.message),
    ).not.toContain(
      "A ChatGPT subscription connection already exists. Replace its credential?",
    );
    expect(createConnection).not.toHaveBeenCalled();
    expect(updateConnection).not.toHaveBeenCalled();
    expect(grant).toHaveBeenCalledWith({
      agentId: agent.id,
      connectionIds: [subscription.id],
    });
  });

  // TEST_SCENARIO: A duplicate Connection name uses the existing rename recovery while every retry remains secret-free.
  it("preserves native authentication when retrying a duplicate name", async () => {
    const { run, createConnection } = setup();
    createConnection.mockRejectedValueOnce({ data: { code: "CONFLICT" } });
    await expect(run()).rejects.toThrow("exit 0");
    expect(createConnection.mock.calls.map(([input]) => input)).toEqual([
      {
        templateId: "openai-chatgpt",
        name: "openai-chatgpt",
        authKind: "none",
      },
      { templateId: "openai-chatgpt", name: "chatgpt-team", authKind: "none" },
    ]);
    expect(prompts.secret).not.toHaveBeenCalled();
  });
});
