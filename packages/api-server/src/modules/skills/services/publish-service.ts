import { TRPCError } from "@trpc/server";
import { emit, EventType } from "../../../events.js";
import type {
  SkillPublishInput,
  SkillPublishResult,
  SkillPublishRecord,
  SkillSource,
} from "api-server-api";
import type { AgentsRepository } from "../../agents/infrastructure/agents-repository.js";
import type { AgentSkillsRepository } from "../infrastructure/agent-skills-repository.js";
import { ensureAgentReachable } from "./ensure-agent-reachable.js";
import {
  AgentRuntimeUpstreamError,
  type AgentRuntimeSkillsClient,
} from "../infrastructure/agent-runtime-client.js";
import { detectHost } from "../domain/git-host.js";
import { upstreamToTrpc } from "../infrastructure/upstream-to-trpc.js";
import { securityLog } from "../../../core/security-log.js";

export interface PublishServiceDeps {
  owner: string;
  surface: string;
  resolveSource: (id: string) => Promise<SkillSource | null>;
  agentSkills: AgentSkillsRepository;
  agents: AgentsRepository;
  runtimeClient: AgentRuntimeSkillsClient;
  brandName: string;
}

export async function publishSkill(
  deps: PublishServiceDeps,
  input: SkillPublishInput,
): Promise<SkillPublishResult> {
  const agent = await ensureAgentReachable(
    deps.agents,
    input.agentId,
    deps.owner,
  );

  const source = await deps.resolveSource(input.sourceId);
  if (!source)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "skill source not found",
    });

  const host = detectHost(source.gitUrl);
  if (!host) {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: `publishing to ${source.gitUrl} isn't supported yet (only GitHub)`,
    });
  }

  const [local, tracked] = await Promise.all([
    deps.runtimeClient.listLocal(input.agentId),
    deps.agentSkills.listSkills(input.agentId),
  ]);
  const origin = local.find((s) => s.name === input.name)?.origin;
  const installedFromSource = tracked.some((s) => s.name === input.name);
  if (
    !installedFromSource &&
    (origin === "system" || origin === "system-modified")
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `"${input.name}" is included with this sandbox's image and can't be published`,
    });
  }

  let result;
  try {
    result = await deps.runtimeClient.publish(input.agentId, {
      name: input.name,
      owner: host.owner,
      repo: host.repo,
      title: input.title?.trim() || `Add ${input.name} skill`,
      body:
        input.body?.trim() ||
        `Published from ${deps.brandName}.\n\n**Skill:** \`${input.name}\``,
      ...(source.path !== undefined ? { path: source.path } : {}),
    });
  } catch (err) {
    if (err instanceof AgentRuntimeUpstreamError) {
      throw upstreamToTrpc(err);
    }
    throw err;
  }

  const record: SkillPublishRecord = {
    skillName: input.name,
    sourceId: source.id,
    sourceName: source.name,
    sourceGitUrl: source.gitUrl,
    prUrl: result.prUrl,
    publishedAt: new Date().toISOString(),
    prState: null,
    prStateCheckedAt: null,
  };
  await deps.agentSkills.appendPublish(input.agentId, record);

  securityLog("info", "skill.publish", {
    category: "privileged",
    actor: deps.owner,
    actorKind: "user",
    agentId: input.agentId,
    target: source.gitUrl,
    result: "success",
    detail: {
      skill: input.name,
      repo: `${host.owner}/${host.repo}`,
      prUrl: result.prUrl,
    },
  });
  emit({
    type: EventType.SkillPublished,
    agentId: input.agentId,
    actorSub: deps.owner,
    surface: deps.surface,
    name: input.name,
  });

  return result;
}
