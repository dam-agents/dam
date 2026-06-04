import { TRPCError } from "@trpc/server";
import type {
  SkillPublishInput,
  SkillPublishResult,
  SkillPublishRecord,
  SkillSource,
} from "api-server-api";
import type { AgentsRepository } from "../../agents/infrastructure/agents-repository.js";
import type { AgentSkillsRepository } from "../infrastructure/agent-skills-repository.js";
import {
  AgentRuntimeUpstreamError,
  type AgentRuntimeSkillsClient,
} from "../infrastructure/agent-runtime-client.js";
import { detectHost } from "../infrastructure/git-host.js";
import { upstreamToTrpc } from "../infrastructure/upstream-to-trpc.js";
import { securityLog } from "../../../core/security-log.js";

const DEFAULT_SKILL_PATHS = ["/home/agent/.agents/skills/"];

export interface PublishServiceDeps {
  owner: string;
  /** Look up a source by id. Must handle real ids (user / system) AND
   *  template-synthesised `template:*` ids — publishing is supposed to work
   *  against template-bound sources too. */
  resolveSource: (id: string) => Promise<SkillSource | null>;
  agentSkills: AgentSkillsRepository;
  agents: AgentsRepository;
  runtimeClient: AgentRuntimeSkillsClient;
  /** Display name surfaced in the auto-generated PR body when the caller
   *  doesn't pass one. Sourced from brand config (env-var driven). */
  brandName: string;
}

/**
 * Publish orchestrator — thin proxy. Validates that the user owns the
 * instance + source and the instance is running, then delegates everything
 * else to agent-runtime (which goes through the in-pod Envoy sidecar's
 * credential injector for the GitHub token swap, ADR-033).
 *
 * Upstream gateway errors (app_not_connected / access_restricted) get
 * re-thrown as tRPC errors with the `connect_url` / `manage_url` carried
 * along in `message` so the UI can parse them.
 */
export async function publishSkill(
  deps: PublishServiceDeps,
  input: SkillPublishInput,
): Promise<SkillPublishResult> {
  const agent = await deps.agents.get(input.agentId, deps.owner);
  if (!agent)
    throw new TRPCError({ code: "NOT_FOUND", message: "agent not found" });
  if (agent.currentState !== "running") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `agent is ${agent.currentState ?? "not running"}; start it before publishing`,
    });
  }

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

  const skillPaths = agent.spec.skillPaths?.length
    ? agent.spec.skillPaths
    : DEFAULT_SKILL_PATHS;

  let result;
  try {
    result = await deps.runtimeClient.publish(input.agentId, {
      name: input.name,
      skillPaths,
      owner: host.owner,
      repo: host.repo,
      title: input.title?.trim() || `Add ${input.name} skill`,
      body:
        input.body?.trim() ||
        `Published from ${deps.brandName}.\n\n**Skill:** \`${input.name}\``,
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
  await deps.agentSkills.appendPublish(input.agentId, record);

  // Credential-backed external write: the agent's injected GitHub PAT opens a
  // PR upstream on the owner's behalf.
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

  return result;
}
