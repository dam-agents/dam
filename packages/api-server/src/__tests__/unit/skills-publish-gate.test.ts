import { describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { LocalSkill, SkillSource } from "api-server-api";
import { publishSkill } from "../../modules/skills/services/publish-service.js";
import type { PublishServiceDeps } from "../../modules/skills/services/publish-service.js";
import type { AgentsRepository } from "../../modules/agents/infrastructure/agents-repository.js";
import type { AgentRuntimeSkillsClient } from "../../modules/skills/infrastructure/agent-runtime-client.js";

const source: SkillSource = {
  id: "src-1",
  name: "my-skills",
  gitUrl: "https://github.com/acme/skills",
  canPublish: true,
};

function makeDeps(local: LocalSkill[]): {
  deps: PublishServiceDeps;
  publish: ReturnType<typeof vi.fn>;
} {
  const publish = vi
    .fn()
    .mockResolvedValue({ prUrl: "https://example/pr/1", branch: "b" });
  const agents = {
    get: vi.fn().mockResolvedValue({ ready: true }),
    ensureReady: vi.fn().mockResolvedValue(undefined),
  } as unknown as AgentsRepository;
  const runtimeClient = {
    listLocal: vi.fn().mockResolvedValue(local),
    publish,
  } as unknown as AgentRuntimeSkillsClient;
  const deps: PublishServiceDeps = {
    owner: "owner-1",
    resolveSource: async () => source,
    agentSkills: {
      appendPublish: vi.fn().mockResolvedValue(undefined),
    } as unknown as PublishServiceDeps["agentSkills"],
    agents,
    runtimeClient,
    brandName: "Test",
  };
  return { deps, publish };
}

const skill = (name: string, origin?: LocalSkill["origin"]): LocalSkill => ({
  name,
  description: "",
  skillPath: "/home/agent/.agents/skills",
  ...(origin !== undefined ? { origin } : {}),
});

const input = { agentId: "agent-1", sourceId: "src-1", name: "websearch" };

describe("publish gate (#2828)", () => {
  it.each([
    ["system", "system" as const],
    ["system-modified", "system-modified" as const],
  ])("refuses an image-shipped skill (%s)", async (_label, origin) => {
    const { deps, publish } = makeDeps([skill("websearch", origin)]);

    await expect(publishSkill(deps, input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it.each([
    ["user", "user" as const],
    ["absent (pre-provenance pod)", undefined],
  ])("lets a user-authored skill through (origin %s)", async (_l, origin) => {
    const { deps, publish } = makeDeps([skill("websearch", origin)]);

    await expect(publishSkill(deps, input)).resolves.toMatchObject({
      prUrl: expect.stringContaining("pr/1"),
    });
    expect(publish).toHaveBeenCalledOnce();
  });

  it("lets an unknown name through to the pod's own not-found error", async () => {
    const { deps, publish } = makeDeps([skill("other", "system")]);

    await publishSkill(deps, input);
    expect(publish).toHaveBeenCalledOnce();
  });

  it("throws TRPCError, not a bare error", async () => {
    const { deps } = makeDeps([skill("websearch", "system")]);
    await expect(publishSkill(deps, input)).rejects.toBeInstanceOf(TRPCError);
  });
});
