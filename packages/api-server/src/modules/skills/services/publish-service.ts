import { TRPCError } from "@trpc/server";
import type {
  PublishSkillInput,
  PublishSkillResult,
  SkillPublishRecord,
  SkillSource,
} from "api-server-api";
import type { AgentsRepository } from "../../agents/infrastructure/agents-repository.js";
import type { InstancesRepository } from "../../agents/infrastructure/instances-repository.js";
import type { InstanceSkillsRepository } from "../infrastructure/instance-skills-repository.js";
import {
  AgentRuntimeUpstreamError,
  type AgentRuntimeSkillsClient,
} from "../infrastructure/agent-runtime-client.js";
import { detectHost } from "../infrastructure/git-host.js";
import { upstreamToTrpc } from "../infrastructure/upstream-to-trpc.js";

const DEFAULT_SKILL_PATHS = ["/home/agent/.agents/skills/"];

export interface PublishServiceDeps {
  owner: string;
  /** Look up a source by id. Must handle real ids (user / system) AND
   *  template-synthesised `template:*` ids — publishing is supposed to work
   *  against template-bound sources too. */
  resolveSource: (id: string) => Promise<SkillSource | null>;
  instances: InstancesRepository;
  instanceSkills: InstanceSkillsRepository;
  agents: AgentsRepository;
  runtimeClient: AgentRuntimeSkillsClient;
  getAgentToken: (agentId: string) => Promise<string>;
}

/**
 * Publish orchestrator — thin proxy. Validates that the user owns the
 * instance + source and the instance is running, then delegates everything
 * else to agent-runtime (which is network-wired to OneCLI's MITM so the
 * GitHub token swap happens server-side).
 *
 * Upstream OneCLI errors (app_not_connected / access_restricted) get
 * re-thrown as tRPC errors with the `connect_url` / `manage_url` carried
 * along in `message` so the UI can parse them.
 */
export async function publishSkill(
  deps: PublishServiceDeps,
  input: PublishSkillInput,
): Promise<PublishSkillResult> {
  const infra = await deps.instances.get(input.instanceId, deps.owner);
  if (!infra) throw new TRPCError({ code: "NOT_FOUND", message: "instance not found" });
  if (infra.currentState !== "running") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `instance is ${infra.currentState ?? "not running"}; start it before publishing`,
    });
  }

  const source = await deps.resolveSource(input.sourceId);
  if (!source) throw new TRPCError({ code: "NOT_FOUND", message: "skill source not found" });

  const host = detectHost(source.gitUrl);
  if (!host) {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: `publishing to ${source.gitUrl} isn't supported yet (only GitHub)`,
    });
  }

  const agent = await deps.agents.get(infra.agentId, deps.owner);
  const skillPaths = agent?.spec.skillPaths?.length
    ? agent.spec.skillPaths
    : DEFAULT_SKILL_PATHS;
  const token = await deps.getAgentToken(infra.agentId);

  let result;
  try {
    result = await deps.runtimeClient.publish(input.instanceId, token, {
      name: input.name,
      skillPaths,
      owner: host.owner,
      repo: host.repo,
      title: input.title?.trim() || `Add ${input.name} skill`,
      body: input.body?.trim() || `Published from Humr.\n\n**Skill:** \`${input.name}\``,
    });
  } catch (err) {
    if (err instanceof AgentRuntimeUpstreamError) {
      throw upstreamToTrpc(err);
    }
    throw err;
  }

  // Explicit publish record. Drives the UI's Published badge + View PR link
  // so we don't fall back to a name-match heuristic that false-positives on
  // unrelated skills sharing a catalog entry's name. Source fields are
  // denormalized so the record survives source renames/deletions.
  const record: SkillPublishRecord = {
    skillName: input.name,
    sourceId: source.id,
    sourceName: source.name,
    sourceGitUrl: source.gitUrl,
    prUrl: result.prUrl,
    publishedAt: new Date().toISOString(),
  };
  await deps.instanceSkills.appendPublish(input.instanceId, record);

  return result;
}
