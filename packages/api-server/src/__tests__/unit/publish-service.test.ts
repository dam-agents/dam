import { describe, it, expect, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { AgentRuntimeSkillsClient } from "../../modules/skills/infrastructure/agent-runtime-client.js";
import { AgentRuntimeUpstreamError } from "../../modules/skills/infrastructure/agent-runtime-client.js";
import type { AgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import type { InstancesRepository } from "../../modules/agents/infrastructure/instances-repository.js";
import type { InstanceSkillsRepository } from "../../modules/skills/infrastructure/instance-skills-repository.js";
import type { InfraInstance } from "../../modules/agents/domain/instance-assembly.js";
import { publishSkill } from "../../modules/skills/services/publish-service.js";

const OWNER = "user-1";
const INSTANCE_ID = "inst-42";
const AGENT_ID = "agent-1";
const SOURCE_ID = "skill-src-abc";

function makeInfra(overrides: Partial<InfraInstance> = {}): InfraInstance {
  return {
    id: INSTANCE_ID,
    name: "inst",
    agentId: AGENT_ID,
    desiredState: "running",
    currentState: "running",
    podReady: true,
    ...overrides,
  };
}

function makeInstanceSkillsRepo(): InstanceSkillsRepository {
  return {
    listSkills: vi.fn().mockResolvedValue([]),
    upsertSkill: vi.fn().mockResolvedValue(undefined),
    removeSkill: vi.fn().mockResolvedValue(undefined),
    removeBySource: vi.fn().mockResolvedValue(undefined),
    reconcile: vi.fn().mockResolvedValue(undefined),
    listPublishes: vi.fn().mockResolvedValue([]),
    appendPublish: vi.fn().mockResolvedValue(undefined),
    deleteByInstance: vi.fn().mockResolvedValue(undefined),
  };
}

function makeDeps() {
  const instances = {
    get: vi.fn().mockResolvedValue(makeInfra()),
  } as unknown as InstancesRepository;
  const resolveSource = vi.fn().mockResolvedValue({
    id: SOURCE_ID,
    name: "Apocohq",
    gitUrl: "https://github.com/foo/bar",
  });
  const agents = {
    get: vi.fn().mockResolvedValue({
      id: AGENT_ID,
      name: "a",
      spec: { skillPaths: ["/home/agent/.claude/skills/"] },
    }),
  } as unknown as AgentsRepository;
  const runtimeClient: AgentRuntimeSkillsClient = {
    install: vi.fn(),
    uninstall: vi.fn(),
    listLocal: vi.fn(),
    publish: vi.fn().mockResolvedValue({
      prUrl: "https://github.com/foo/bar/pull/1",
      branch: "humr/publish-demo-20260101000000",
    }),
    scan: vi.fn().mockResolvedValue([]),
  };
  const getAgentToken = vi.fn().mockResolvedValue("agent-token");
  const instanceSkills = makeInstanceSkillsRepo();

  return {
    deps: {
      owner: OWNER,
      resolveSource,
      instances,
      instanceSkills,
      agents,
      runtimeClient,
      getAgentToken,
    },
    runtimeClient,
    resolveSource,
    instanceSkills,
  };
}

const input = {
  instanceId: INSTANCE_ID,
  sourceId: SOURCE_ID,
  name: "demo",
  title: undefined,
  body: undefined,
};

describe("publishSkill — thin proxy", () => {
  it("calls agent-runtime with detected owner/repo + skillPaths and returns the result", async () => {
    const { deps, runtimeClient } = makeDeps();

    const result = await publishSkill(deps, input);

    expect(runtimeClient.publish).toHaveBeenCalledWith(
      INSTANCE_ID,
      "agent-token",
      expect.objectContaining({
        name: "demo",
        owner: "foo",
        repo: "bar",
        skillPaths: ["/home/agent/.claude/skills/"],
      }),
    );
    expect(result.prUrl).toBe("https://github.com/foo/bar/pull/1");
  });

  it("appends a publish record to the instance on success", async () => {
    const { deps, instanceSkills } = makeDeps();
    await publishSkill(deps, input);

    expect(instanceSkills.appendPublish).toHaveBeenCalledTimes(1);
    expect(instanceSkills.appendPublish).toHaveBeenCalledWith(
      INSTANCE_ID,
      expect.objectContaining({
        skillName: "demo",
        sourceId: SOURCE_ID,
        sourceName: "Apocohq",
        sourceGitUrl: "https://github.com/foo/bar",
        prUrl: "https://github.com/foo/bar/pull/1",
        publishedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      }),
    );
  });

  it("does not append a publish record when agent-runtime fails", async () => {
    const { deps, runtimeClient, instanceSkills } = makeDeps();
    (runtimeClient.publish as any) = vi.fn().mockRejectedValue(new Error("upstream down"));

    await expect(publishSkill(deps, input)).rejects.toThrow(/upstream down/);
    expect(instanceSkills.appendPublish).not.toHaveBeenCalled();
  });

  it("NOT_FOUND when instance is missing", async () => {
    const { deps } = makeDeps();
    (deps.instances as any).get = vi.fn().mockResolvedValue(null);
    await expect(publishSkill(deps, input)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("PRECONDITION_FAILED when instance is hibernated", async () => {
    const { deps } = makeDeps();
    (deps.instances as any).get = vi.fn().mockResolvedValue(makeInfra({ currentState: "hibernated" }));
    await expect(publishSkill(deps, input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("NOT_IMPLEMENTED when source host is unsupported", async () => {
    const { deps, resolveSource } = makeDeps();
    resolveSource.mockResolvedValue({
      id: SOURCE_ID,
      name: "Foo",
      gitUrl: "https://gitlab.com/foo/bar",
    });
    await expect(publishSkill(deps, input)).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
  });

  it("translates OneCLI 'app_not_connected' to a PRECONDITION_FAILED with humr-cta: URL", async () => {
    const { deps, runtimeClient } = makeDeps();
    (runtimeClient.publish as any) = vi.fn().mockRejectedValue(
      new AgentRuntimeUpstreamError("agent-runtime error", {
        status: 401,
        body: {
          error: "app_not_connected",
          message: "GitHub is not connected in OneCLI.",
          connect_url: "http://localhost:4444/connections?connect=github",
          provider: "github",
        },
      }),
    );

    await expect(publishSkill(deps, input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });

    // The message should carry the CTA URL so the UI can parse it out.
    const err = (await publishSkill(deps, input).catch((e) => e)) as TRPCError;
    expect(err.message).toContain("humr-cta:http://localhost:4444/connections?connect=github");
  });

  it("translates OneCLI 'access_restricted' (agent not granted) similarly with manage_url", async () => {
    const { deps, runtimeClient } = makeDeps();
    (runtimeClient.publish as any) = vi.fn().mockRejectedValue(
      new AgentRuntimeUpstreamError("agent-runtime error", {
        status: 401,
        body: {
          error: "access_restricted",
          message: "Agent does not have access.",
          manage_url: "http://localhost:4444/agents?manage=abc",
          provider: "github",
        },
      }),
    );

    const err = (await publishSkill(deps, input).catch((e) => e)) as TRPCError;
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("PRECONDITION_FAILED");
    expect(err.message).toContain("humr-cta:http://localhost:4444/agents?manage=abc");
  });
});
