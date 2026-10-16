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
      setDisabled: vi.fn(),
      runtimeFleet: vi.fn(),
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

  /** TEST_SCENARIO: Without --provider the create names none, and the
   * platform grants the caller's default provider Connection itself. */
  it("creates without a provider when none is named, leaving the default to the platform", async () => {
    const { run, create, listConnections } = setup();
    await run([], EXIT_SUCCESS);
    expect(listConnections).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({
      name: "via cli",
      templateId: "claude-code",
    });
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
        providerConnectionId: provider.id,
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
      ref: provider.name,
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

  it.each(["expired", "pending", "disconnected", "not a model provider"])(
    "surfaces the server's rejection when the provider is %s",
    async (status) => {
      const { run, create, getAgent } = setup();
      create.mockRejectedValue(
        Object.assign(new Error(`provider is ${status}`), {
          data: { code: "BAD_REQUEST" },
        }),
      );
      await run(["--provider", provider.id, "--wait"], EXIT_INVALID_INPUT);
      expect(getAgent).not.toHaveBeenCalled();
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining(`is ${status}`),
      );
    },
  );

  it("creates by id without listing connections when credential reads are forbidden", async () => {
    const { run, create, listConnections } = setup();
    listConnections.mockRejectedValue(new Error("Requires credentials:read"));
    await run(["--provider", provider.id], EXIT_SUCCESS);
    expect(listConnections).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        providerConnectionId: provider.id,
      }),
    );
  });

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
    await run(["--provider", provider.name], EXIT_RUNTIME_FAILURE);
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
      providerConnectionId: provider.id,
      env: [{ name: "FOO", value: "bar" }],
      description: "Helper",
    });
    expect(create.mock.invocationCallOrder[0]).toBeLessThan(
      getAgent.mock.invocationCallOrder[0]!,
    );
  });
});

describe("dam agent create --wait on a refused start (#4760)", () => {
  const shortfall =
    "the owner's VM runner has 512 MiB free and this machine needs 2048 MiB";

  beforeEach(() => {
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit ${code}`);
    });
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => vi.restoreAllMocks());

  function refused(extra: Record<string, unknown>) {
    const { run, create, getAgent } = setup();
    create.mockResolvedValue({ ...agent, state: "starting" });
    const parked = { ...agent, state: "over_budget", ...extra };
    getAgent.mockResolvedValue({ ok: true, value: parked });
    return { run, getAgent, parked };
  }

  /** TEST_SCENARIO: A new agent that its owner's pool cannot hold is parked
   * on its first reconcile; the wait names the refusal at that first poll
   * instead of polling until the timeout. */
  it("stops at the first over_budget poll and prints the refusal", async () => {
    const { run, getAgent } = refused({
      overBudget: true,
      overBudgetMessage: shortfall,
    });
    await run(["--wait"], EXIT_RUNTIME_FAILURE);
    expect(getAgent).toHaveBeenCalledTimes(1);
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining(`could not start: ${shortfall}`),
    );
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining("free room"),
    );
  });

  /** TEST_SCENARIO: Scripted callers read the refusal from the Agent payload,
   * so --json prints the parked Agent with its message on stdout. */
  it("emits the parked Agent under --json", async () => {
    const { run, parked } = refused({ overBudgetMessage: shortfall });
    await run(["--wait", "--json"], EXIT_RUNTIME_FAILURE);
    expect(process.stdout.write).toHaveBeenCalledWith(
      `${JSON.stringify(parked)}\n`,
    );
  });

  /** TEST_SCENARIO: A start refused because the owner's storage is full
   * lands in the error state with its text on podTerminationReason only; the
   * wait prints that text, not "unknown". */
  it("prints the pod termination reason for an error with no reconcile error", async () => {
    const { run, getAgent } = setup();
    getAgent.mockResolvedValue({
      ok: true,
      value: {
        ...agent,
        state: "error",
        podTerminationReason: "your agents' shared storage is full",
      },
    });
    await run(["--wait"], EXIT_RUNTIME_FAILURE);
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining("your agents' shared storage is full"),
    );
  });

  /** TEST_SCENARIO: An image pull failure is a refused start, as the UI says
   * "can't start" for it, so the wait says "could not start" rather than
   * "entered error state". */
  it("says could not start for an image that can't be pulled", async () => {
    const { run, getAgent } = setup();
    getAgent.mockResolvedValue({
      ok: true,
      value: {
        ...agent,
        state: "error",
        podTerminationCode: "ImagePullFailure",
        podTerminationReason: "the agent's image can't be pulled",
      },
    });
    await run(["--wait"], EXIT_RUNTIME_FAILURE);
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining(
        "could not start: the agent's image can't be pulled",
      ),
    );
  });
});
