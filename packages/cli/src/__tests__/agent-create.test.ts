// TEST_OVERVIEW: Scripted agent creation requires a model-provider Connection and includes its grant in the create request before waiting for readiness.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionView } from "api-server-api";
import { buildCreateCommand } from "../modules/agent/commands/create.js";
import type { TrpcClient } from "../modules/shared/trpc/trpc-client.js";
import {
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../modules/shared/exit-codes.js";

const provider: ConnectionView = {
  id: "conn-provider",
  ownerId: "user-1",
  templateId: "anthropic",
  category: "app",
  name: "My provider",
  status: "active",
  authKind: "header",
  contributions: [],
  hosts: ["api.anthropic.com"],
};

const agent = {
  id: "agent-created",
  name: "via cli",
  templateId: "claude-code",
  image: "claude-code:latest",
  state: "running" as const,
  channels: [],
};

function setup(connections: ConnectionView[] = [provider]) {
  const listConnections = vi.fn().mockResolvedValue(connections);
  const create = vi.fn().mockResolvedValue(agent);
  const getAgent = vi.fn().mockResolvedValue({ ok: true, value: agent });
  const trpc = {
    connections: { list: { query: listConnections } },
    agents: { create: { mutate: create } },
  } as unknown as TrpcClient;
  const command = buildCreateCommand({
    compatService: {
      check: async () => ({
        ok: true,
        value: {
          kind: "ok",
          localCli: "1.0.0",
          serverVersion: "1.0.0",
          serverMinClient: undefined,
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
    createAgentService: () => ({
      list: vi.fn(),
      get: getAgent,
      deleteAgent: vi.fn(),
      restart: vi.fn(),
    }),
    createTemplateService: () => ({
      list: async () => ({
        ok: true,
        value: [{ id: "claude-code", name: "Claude Code", image: agent.image }],
      }),
    }),
    createTrpcClient: () => trpc,
  });

  async function run(args: string[], exitCode: number) {
    await expect(
      command.parseAsync(["via cli", "--template", "claude-code", ...args], {
        from: "user",
      }),
    ).rejects.toThrow(`exit ${exitCode}`);
  }
  return { run, create, listConnections, getAgent };
}

describe("dam agent create provider selection (#3786)", () => {
  beforeEach(() => {
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit ${code}`);
    });
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => vi.restoreAllMocks());

  it("rejects a missing provider before making any request, with setup guidance", async () => {
    const { run, create, listConnections } = setup();
    await run([], EXIT_INVALID_INPUT);
    expect(create).not.toHaveBeenCalled();
    expect(listConnections).not.toHaveBeenCalled();
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining("--provider <id-or-name>"),
    );
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining("dam agent create-interactive"),
    );
  });

  it.each([provider.id, provider.name])(
    "grants the provider selected by %s in the creation request and preserves JSON output",
    async (ref) => {
      const { run, create } = setup();
      await run(["--provider", ref, "--json"], EXIT_SUCCESS);
      expect(create).toHaveBeenCalledWith({
        name: "via cli",
        templateId: "claude-code",
        connectionIds: [provider.id],
      });
      expect(process.stdout.write).toHaveBeenCalledWith(
        `${JSON.stringify(agent)}\n`,
      );
    },
  );

  it.each([
    { label: "unknown", connections: [provider], ref: "missing" },
    { label: "absent", connections: [], ref: provider.name },
    {
      label: "non-provider",
      connections: [{ ...provider, templateId: "github" }],
      ref: provider.id,
    },
    {
      label: "ambiguous",
      connections: [provider, { ...provider, id: "conn-other" }],
      ref: provider.name,
    },
  ])(
    "rejects $label selections without creating an agent",
    async ({ connections, ref }) => {
      const { run, create } = setup(connections);
      await run(["--provider", ref], EXIT_INVALID_INPUT);
      expect(create).not.toHaveBeenCalled();
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining("dam connection list"),
      );
    },
  );

  it.each(["expired", "pending", "disconnected"] as const)(
    "rejects a %s provider before creating an agent",
    async (status) => {
      const { run, create } = setup([{ ...provider, status }]);
      await run(["--provider", provider.id], EXIT_INVALID_INPUT);
      expect(create).not.toHaveBeenCalled();
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining(`is ${status}`),
      );
    },
  );

  it("allows an explicit id to disambiguate duplicate provider names", async () => {
    const { run, create } = setup([
      provider,
      { ...provider, id: "conn-other" },
    ]);
    await run(["--provider", "conn-other"], EXIT_SUCCESS);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ connectionIds: ["conn-other"] }),
    );
  });

  it("fails without creating an agent when connections cannot be listed", async () => {
    const { run, create, listConnections } = setup();
    listConnections.mockRejectedValue(new Error("connection listing failed"));
    await run(["--provider", provider.id], EXIT_RUNTIME_FAILURE);
    expect(create).not.toHaveBeenCalled();
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining("connection listing failed"),
    );
  });

  it("includes the provider before waiting and preserves env and description", async () => {
    const { run, create, getAgent } = setup();
    await run(
      [
        "--provider",
        provider.id,
        "--wait",
        "--env",
        "FOO=bar",
        "--description",
        "Helper",
      ],
      EXIT_SUCCESS,
    );
    expect(create).toHaveBeenCalledWith({
      name: "via cli",
      templateId: "claude-code",
      connectionIds: [provider.id],
      env: [{ name: "FOO", value: "bar" }],
      description: "Helper",
    });
    expect(create.mock.invocationCallOrder[0]).toBeLessThan(
      getAgent.mock.invocationCallOrder[0]!,
    );
  });
});
